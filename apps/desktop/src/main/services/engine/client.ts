import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import {
  ENGINE_PROTOCOL_VERSION,
  MAX_LINE_BYTES,
  engineMessageSchema,
  type ActionOutcome,
  type ActionProgress,
  type ActionRequest,
  type EngineMessage,
  type EngineStatus,
} from "@automation-studio/shared-types";
import type { EngineLaunch } from "./launch.js";

export interface EngineClientOptions {
  /** Resolvido a cada (re)início. Pode lançar erro: vira `unavailable`. */
  launch: () => EngineLaunch | Promise<EngineLaunch>;
  spawn?: typeof nodeSpawn;
  log?: (level: "debug" | "warn" | "error", message: string) => void;
  heartbeatMs?: number;
  /** Pings sem resposta (consecutivos) até considerar o motor travado. */
  maxMissedPings?: number;
  readyTimeoutMs?: number;
  stopGraceMs?: number;
  /** Reinícios permitidos dentro de `crashWindowMs`; além disso o motor fica indisponível. */
  maxRestarts?: number;
  crashWindowMs?: number;
  restartBackoffMs?: number[];
}

type Pending = {
  executionId: string;
  nodeId: string;
  resolve: (o: ActionOutcome) => void;
  onProgress?: (p: ActionProgress) => void;
  cancelRequested: boolean;
};

const MIN_PYTHON: [number, number] = [3, 11];
const stoppedStatus: EngineStatus = { state: "unavailable", reason: "O motor foi encerrado." };

/** Gerencia o processo do motor Python: ciclo de vida, heartbeat, reinício e requisições. */
export class EngineClient extends EventEmitter {
  private opts: Required<Omit<EngineClientOptions, "spawn" | "log">> & Pick<EngineClientOptions, "spawn" | "log">;
  private _status: EngineStatus = { state: "starting" };
  private child: ChildProcess | null = null;
  private buf: Buffer = Buffer.alloc(0);
  private discarding = false;
  private pending = new Map<string, Pending>();
  private seq = 0;
  private stopping = false;
  private crashTimes: number[] = [];
  private stderrTail: string[] = [];
  private timers = new Set<NodeJS.Timeout>();
  private heartbeat: NodeJS.Timeout | null = null;
  private awaitingPong = false;
  private missed = 0;
  private readyTimer: NodeJS.Timeout | null = null;
  private exitWaiters: Array<() => void> = [];
  private killReason: string | null = null;

  constructor(options: EngineClientOptions) {
    super();
    this.opts = {
      heartbeatMs: 5000,
      maxMissedPings: 3,
      readyTimeoutMs: 10_000,
      stopGraceMs: 2000,
      maxRestarts: 3,
      crashWindowMs: 60_000,
      restartBackoffMs: [250, 1000, 3000],
      ...options,
    };
  }

  get status(): EngineStatus {
    return this._status;
  }

  private setStatus(next: EngineStatus): void {
    if (JSON.stringify(next) === JSON.stringify(this._status)) return;
    this._status = next;
    this.emit("status", next);
  }

  private log(level: "debug" | "warn" | "error", message: string): void {
    this.opts.log?.(level, message);
  }

  private later(fn: () => void, ms: number): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
  }

  // ---------- ciclo de vida ----------
  start(): void {
    if (this.child || this.stopping) return;
    this.setStatus({ state: "starting" });
    void this.launchOnce();
  }

  private async launchOnce(): Promise<void> {
    let launch: EngineLaunch;
    try {
      launch = await this.opts.launch();
    } catch (err) {
      this.setStatus({ state: "unavailable", reason: `Não foi possível preparar o motor: ${(err as Error).message}` });
      return;
    }
    if (this.stopping) return;
    this.buf = Buffer.alloc(0);
    this.discarding = false;
    this.stderrTail = [];
    this.killReason = null;
    this.awaitingPong = false;
    this.missed = 0;

    let child: ChildProcess;
    try {
      child = (this.opts.spawn ?? nodeSpawn)(launch.command, launch.args, {
        cwd: launch.cwd,
        env: { ...process.env, ...launch.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      this.setStatus({ state: "unavailable", reason: `Não foi possível iniciar o motor: ${(err as Error).message}` });
      return;
    }
    this.child = child;
    child.stdin?.on("error", () => undefined); // EPIPE: o processo já morreu, o 'exit' trata
    child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    child.stderr?.on("data", (chunk: Buffer) => this.onStderr(chunk));
    child.on("error", (err: NodeJS.ErrnoException) => {
      if (child !== this.child) return;
      // Comando inexistente é problema de instalação, não adianta tentar de novo.
      this.child = null;
      this.cleanupProcessState();
      this.failPending("ENGINE_CRASHED", "O motor de automação não pôde ser iniciado.");
      // O Node devolve ENOENT tanto para comando inexistente quanto para `cwd` inexistente: distinguimos.
      if (err.code === "ENOENT" && launch.cwd && !existsSync(launch.cwd)) {
        this.setStatus({ state: "unavailable", reason: `A pasta do motor não foi encontrada (${launch.cwd}). A instalação pode estar incompleta.` });
        return;
      }
      const hint = err.code === "ENOENT" ? ` (“${launch.command}” não encontrado)` : `: ${err.message}`;
      this.setStatus({ state: "unavailable", reason: `Não foi possível iniciar o motor${hint}. Instale o Python 3.11+ ou defina AUTOMATION_STUDIO_PYTHON.` });
    });
    child.on("exit", (code, signal) => this.onExit(child, code, signal));

    this.readyTimer = setTimeout(() => {
      this.log("error", "Motor não respondeu com 'ready' a tempo; encerrando.");
      this.killReason = "O motor não respondeu ao iniciar.";
      child.kill("SIGKILL");
    }, this.opts.readyTimeoutMs);
  }

  private cleanupProcessState(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  private onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    if (child !== this.child) return;
    this.child = null;
    this.cleanupProcessState();
    this.log("warn", `Motor encerrou (code=${code}, signal=${signal}).`);
    const reason = this.killReason;
    this.killReason = null;
    this.failPending("ENGINE_CRASHED", reason ?? "O motor de automação encerrou inesperadamente.");
    for (const w of this.exitWaiters.splice(0)) w();
    if (this.stopping) return;

    const now = Date.now();
    this.crashTimes = [...this.crashTimes.filter((t) => now - t < this.opts.crashWindowMs), now];
    if (this.crashTimes.length > this.opts.maxRestarts) {
      const last = this.stderrTail.at(-1);
      this.setStatus({
        state: "unavailable",
        reason: `O motor falhou ${this.crashTimes.length} vezes seguidas${reason ? ` (${reason})` : ` (código ${code ?? signal})`}.${last ? ` Último erro: ${last}` : ""}`,
      });
      return;
    }
    this.setStatus({ state: "restarting" });
    const backoff = this.opts.restartBackoffMs[Math.min(this.crashTimes.length - 1, this.opts.restartBackoffMs.length - 1)] ?? 1000;
    this.later(() => void this.launchOnce(), backoff);
  }

  /** Encerra com `shutdown` educado; mata se não sair a tempo. */
  async stop(): Promise<void> {
    this.stopping = true;
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    const child = this.child;
    if (child) {
      const exited = new Promise<void>((resolve) => this.exitWaiters.push(resolve));
      this.write({ type: "shutdown", requestId: this.nextId(), payload: {} });
      const timer = setTimeout(() => child.kill("SIGKILL"), this.opts.stopGraceMs);
      await exited;
      clearTimeout(timer);
    }
    this.cleanupProcessState();
    this.failPending("ENGINE_CRASHED", "O motor foi encerrado.");
    this.setStatus(stoppedStatus);
  }

  // ---------- leitura (JSON Lines com limite) ----------
  private onStderr(chunk: Buffer): void {
    for (const line of chunk.toString("utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      this.stderrTail = [...this.stderrTail.slice(-9), line.slice(0, 500)];
      this.log("debug", `[stderr] ${line}`);
    }
  }

  private onData(chunk: Buffer): void {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    for (;;) {
      const nl = this.buf.indexOf(0x0a);
      if (nl < 0) {
        if (this.buf.length > MAX_LINE_BYTES) {
          // linha sem fim e já grande demais: descarta o que veio e ignora até o próximo \n
          this.log("warn", "Linha do motor acima de 1 MiB descartada.");
          this.discarding = true;
          this.buf = Buffer.alloc(0);
        }
        return;
      }
      const line = this.buf.subarray(0, nl);
      this.buf = this.buf.subarray(nl + 1);
      if (this.discarding) {
        this.discarding = false; // este era o fim da linha gigante
        continue;
      }
      if (line.length > MAX_LINE_BYTES) {
        this.log("warn", "Linha do motor acima de 1 MiB descartada.");
        continue;
      }
      this.onLine(line.toString("utf8").trim());
    }
  }

  private onLine(text: string): void {
    if (!text) return;
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      this.log("warn", `Linha inválida no stdout do motor (ignorada): ${text.slice(0, 120)}`);
      return;
    }
    const parsed = engineMessageSchema.safeParse(json);
    if (!parsed.success) {
      this.log("warn", `Mensagem do motor fora do protocolo (ignorada): ${text.slice(0, 120)}`);
      return;
    }
    this.onMessage(parsed.data);
  }

  private onMessage(msg: EngineMessage): void {
    switch (msg.type) {
      case "ready": {
        this.cleanupReadyTimer();
        const p = msg.payload;
        const [major = 0, minor = 0] = p.python.split(".").map(Number);
        if (p.protocolVersion !== ENGINE_PROTOCOL_VERSION) {
          this.fatal(`O motor usa o protocolo v${p.protocolVersion}, mas o app espera v${ENGINE_PROTOCOL_VERSION}.`);
        } else if (major < MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor < MIN_PYTHON[1])) {
          this.fatal(`Python ${p.python} é antigo demais; é necessário o Python ${MIN_PYTHON.join(".")} ou superior.`);
        } else {
          this.setStatus({ state: "ready", engineVersion: p.engineVersion, python: p.python, platform: p.platform, actions: p.actions, optionalModules: p.optionalModules });
          this.startHeartbeat();
        }
        return;
      }
      case "pong":
        this.awaitingPong = false;
        this.missed = 0;
        return;
      case "action_started":
        return;
      case "action_progress": {
        const { executionId, nodeId, ...p } = msg.payload;
        this.findPending(msg.requestId)?.onProgress?.({ percent: p.percent, message: p.message });
        void executionId;
        void nodeId;
        return;
      }
      case "action_completed": {
        const { outputs, next, message } = msg.payload;
        this.settle(msg.requestId, { kind: "completed", outputs, next, message });
        return;
      }
      case "action_failed":
        this.settle(msg.requestId, { kind: "failed", error: msg.payload.error });
        return;
      case "action_cancelled":
        this.settle(msg.requestId, { kind: "cancelled" });
        return;
      case "protocol_error":
        this.log("warn", `Motor reportou erro de protocolo: ${msg.payload.message}`);
        return;
      case "cancel_ack":
      case "bye":
        return;
    }
  }

  private cleanupReadyTimer(): void {
    if (this.readyTimer) clearTimeout(this.readyTimer);
    this.readyTimer = null;
  }

  /** Problema que reiniciar não resolve (versão incompatível): para e avisa. */
  private fatal(reason: string): void {
    this.stopping = true; // evita reinício automático
    this.setStatus({ state: "unavailable", reason });
    this.child?.kill("SIGKILL");
  }

  // ---------- heartbeat ----------
  private startHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.awaitingPong = false;
    this.missed = 0;
    this.heartbeat = setInterval(() => {
      if (this.awaitingPong) this.missed++;
      else this.missed = 0;
      if (this.missed >= this.opts.maxMissedPings) {
        this.log("error", "Motor não responde ao heartbeat; reiniciando.");
        this.killReason = "O motor parou de responder.";
        this.child?.kill("SIGKILL");
        return;
      }
      this.awaitingPong = true;
      this.write({ type: "ping", requestId: this.nextId("hb"), payload: {} });
    }, this.opts.heartbeatMs);
    this.heartbeat.unref?.();
  }

  // ---------- requisições ----------
  private nextId(prefix = "r"): string {
    return `${prefix}-${++this.seq}`;
  }

  private write(msg: { type: string; requestId: string; payload: unknown }): boolean {
    const stdin = this.child?.stdin;
    if (!stdin || stdin.destroyed || !stdin.writable) return false;
    stdin.write(JSON.stringify(msg) + "\n");
    return true;
  }

  private findPending(requestId: string): Pending | undefined {
    return this.pending.get(requestId);
  }

  private settle(requestId: string, outcome: ActionOutcome): void {
    const p = this.pending.get(requestId);
    if (!p) return;
    this.pending.delete(requestId);
    p.resolve(outcome);
  }

  /** Resolve todas as ações em voo: as que o usuário mandou cancelar contam como canceladas. */
  private failPending(code: string, message: string): void {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      p.resolve(p.cancelRequested ? { kind: "cancelled" } : { kind: "failed", error: { code, message } });
    }
  }

  executeAction(req: ActionRequest, onProgress?: (p: ActionProgress) => void): Promise<ActionOutcome> {
    const s = this._status;
    if (s.state !== "ready") {
      const why = s.state === "unavailable" ? s.reason : "O motor está iniciando; tente novamente em instantes.";
      return Promise.resolve({ kind: "failed", error: { code: "ENGINE_UNAVAILABLE", message: `O motor de automação não está disponível. ${why}` } });
    }
    return new Promise<ActionOutcome>((resolve) => {
      const requestId = this.nextId("act");
      this.pending.set(requestId, { executionId: req.executionId, nodeId: req.nodeId, resolve, onProgress, cancelRequested: false });
      const ok = this.write({ type: "execute_action", requestId, payload: { executionId: req.executionId, nodeId: req.nodeId, action: req.action, config: req.config } });
      if (!ok) this.settle(requestId, { kind: "failed", error: { code: "ENGINE_CRASHED", message: "Não foi possível falar com o motor." } });
    });
  }

  /**
   * Cancelamento cooperativo; se a ação não parar em `killAfterMs`, mata o motor
   * (ele reinicia sozinho) para o cancelamento nunca deixar o app preso.
   */
  cancel(executionId: string, killAfterMs = 3000): void {
    let any = false;
    for (const p of this.pending.values()) {
      if (p.executionId === executionId) {
        p.cancelRequested = true;
        any = true;
      }
    }
    if (!any) return;
    this.write({ type: "cancel", requestId: this.nextId("cx"), payload: { executionId } });
    this.later(() => {
      const stuck = [...this.pending.values()].some((p) => p.executionId === executionId);
      if (stuck && this.child) {
        this.log("warn", "Ação não obedeceu ao cancelamento; reiniciando o motor.");
        this.killReason = "A ação não respondeu ao cancelamento e o motor foi reiniciado.";
        this.child.kill("SIGKILL");
      }
    }, killAfterMs);
  }
}
