import type { ChildProcessWithoutNullStreams } from "node:child_process";
import type { RecordedStep, RecorderStatus } from "@automation-studio/shared-types";
import { AppError } from "../errors.js";
import { LIMITS, eventsToSteps, type RecEvent, type Rect } from "./convert.js";

export type { RecorderStatus };

export interface RecorderDeps {
  /** Inicia o processo gravador (`--record`). Em produção: spawn do motor com o argumento. */
  spawn(): ChildProcessWithoutNullStreams;
  /** Só Windows grava de verdade; em teste (fonte falsa) isto é liberado. */
  supported: boolean;
  onStatus(s: RecorderStatus): void;
  /** Retângulos das janelas do app que estão VISÍVEIS agora (não minimizadas). Usado só para tirar o clique do próprio botão Pausar/Parar. */
  ignoreRects(): Rect[];
  now?: () => number;
  startTimeoutMs?: number;
  stopTimeoutMs?: number;
}

const MAX_LINE = 64 * 1024;

/**
 * Gravador (ADR 0016). Os eventos ficam SÓ EM MEMÓRIA, neste objeto, até o usuário revisar e criar a automação (ou descartar).
 * Nada é gravado em disco, em log nem em histórico.
 */
export function createRecorderService({ spawn, supported, onStatus, ignoreRects, now = Date.now, startTimeoutMs = 10_000, stopTimeoutMs = 3000 }: RecorderDeps) {
  let state: RecorderStatus["state"] = "idle";
  let child: ChildProcessWithoutNullStreams | null = null;
  let events: RecEvent[] = [];
  /** Instante de chegada de cada evento (mesma ordem de `events`), só para achar o clique no botão do app. */
  let arrivals: number[] = [];
  let paused = false;
  let secret = false;
  let notice: string | null = null;
  let waiter: { resolve(): void; reject(e: AppError): void } | null = null;

  const status = (): RecorderStatus => ({ state, events: events.length, paused, secret, notice });
  const push = () => onStatus(status());
  const reset = () => {
    events = [];
    arrivals = [];
    paused = false;
    secret = false;
    notice = null;
  };
  const kill = () => {
    const c = child;
    child = null;
    if (c && c.exitCode === null) c.kill("SIGKILL");
  };

  /** O usuário acabou de clicar num botão do PRÓPRIO app (Pausar/Parar): esse clique não faz parte da automação. */
  function dropTrailingUiClick() {
    const i = events.length - 1;
    const e = events[i];
    if (!e || e.t !== "click" || now() - arrivals[i]! > 2000) return;
    if (ignoreRects().some((r) => e.x >= r.x && e.x < r.x + r.width && e.y >= r.y && e.y < r.y + r.height)) {
      events.pop();
      arrivals.pop();
    }
  }

  function handle(ev: RecEvent) {
    if (ev.t === "ready") {
      state = "recording";
      waiter?.resolve();
      waiter = null;
    } else if (ev.t === "error") {
      const msg = typeof ev["message"] === "string" ? (ev["message"] as string) : "O gravador não pôde iniciar.";
      waiter?.reject(new AppError("ENGINE_UNAVAILABLE", msg));
      waiter = null;
      notice = msg;
    } else if (ev.t === "paused") paused = ev["on"] === true;
    else if (ev.t === "secret") secret = ev["on"] === true;
    else if (ev.t === "stop") {
      // o usuário pediu parar (atalho global): quem fecha é `stop()` ou o fim do processo
      if (state === "recording") state = "stopping";
    } else if (ev.t === "click" || ev.t === "char" || ev.t === "secret_key" || ev.t === "hotkey") {
      if (events.length >= LIMITS.maxEvents) {
        notice = `Limite de ${LIMITS.maxEvents} eventos atingido: a gravação foi parada.`;
        child?.stdin.write("stop\n");
      } else {
        events.push(ev);
        arrivals.push(now());
      }
    }
    push();
  }

  function attach(c: ChildProcessWithoutNullStreams) {
    let buf = "";
    c.stdout.setEncoding("utf8");
    c.stdout.on("data", (chunk: string) => {
      buf += chunk;
      for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (line.length > MAX_LINE) continue; // linha anormal: descarta
        try {
          const ev = JSON.parse(line) as RecEvent;
          if (ev && typeof ev === "object" && typeof ev.t === "string") handle(ev);
        } catch {
          /* linha que não é JSON: ignora (stdout do gravador é só protocolo) */
        }
      }
      if (buf.length > MAX_LINE) buf = "";
    });
    c.stderr.on("data", () => undefined); // diagnóstico do Python: nunca vai para log (pode conter teclas)
    c.on("exit", () => {
      if (child === c) child = null;
      waiter?.reject(new AppError("ENGINE_UNAVAILABLE", "O gravador encerrou antes de iniciar. Verifique se o pacote pynput está instalado (engine/python/requirements-recorder.txt)."));
      waiter = null;
      if (state === "starting") state = "idle";
      else if (state === "recording") state = "stopping"; // caiu/terminou: o que foi gravado ainda pode ser revisado
      push();
    });
  }

  return {
    status,

    async start(): Promise<RecorderStatus> {
      if (!supported) throw new AppError("VALIDATION", "O gravador só funciona no Windows.");
      if (state !== "idle") throw new AppError("EXECUTION_BUSY", "Já há uma gravação em andamento ou aguardando revisão.");
      reset();
      state = "starting";
      push();
      try {
        child = spawn();
      } catch {
        state = "idle";
        push();
        throw new AppError("ENGINE_UNAVAILABLE", "Não foi possível iniciar o gravador.");
      }
      attach(child);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await new Promise<void>((resolve, reject) => {
          waiter = { resolve, reject };
          timer = setTimeout(() => reject(new AppError("ENGINE_UNAVAILABLE", "O gravador não respondeu a tempo.")), startTimeoutMs);
        });
      } catch (err) {
        kill();
        state = "idle";
        reset();
        push();
        throw err;
      } finally {
        if (timer) clearTimeout(timer);
        waiter = null;
      }
      return status();
    },

    pause(): RecorderStatus {
      if (state !== "recording") throw new AppError("VALIDATION", "Não há gravação em andamento.");
      dropTrailingUiClick();
      child?.stdin.write("pause\n");
      return status();
    },

    /** Para e devolve os passos para revisão. Os eventos continuam em memória até `finish()`. */
    async stop(): Promise<RecordedStep[]> {
      if (state !== "recording" && state !== "stopping") throw new AppError("VALIDATION", "Não há gravação para parar.");
      if (state === "recording") dropTrailingUiClick(); // parou pelo botão (pelo atalho global o estado já é 'stopping')
      const c = child;
      if (c && c.exitCode === null) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, stopTimeoutMs);
          c.once("exit", () => (clearTimeout(t), resolve()));
          c.stdin.write("stop\n");
        });
      }
      kill();
      state = "stopping";
      const steps = eventsToSteps(events);
      push();
      return steps;
    },

    /** Fim do ciclo (criou a automação ou descartou): apaga TUDO da memória. */
    finish(): RecorderStatus {
      kill();
      reset();
      state = "idle";
      push();
      return status();
    },
  };
}
export type RecorderService = ReturnType<typeof createRecorderService>;
