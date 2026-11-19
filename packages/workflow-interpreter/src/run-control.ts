import type { PauseReason } from "@automation-studio/shared-types";

/**
 * Pausa cooperativa: só vale no LIMITE entre nós (uma ação em andamento termina antes).
 * Passo a passo = pausar antes de cada nó; breakpoint = pausar antes de um nó específico.
 */
export class RunControl {
  private pauseRequested = false;
  private stepArmed = false;
  private startPause: boolean;
  private waiter: (() => void) | null = null;
  private breakpoints: Set<string>;
  /** O interpretador avisa a interface de que o pedido foi recebido (a pausa só ocorre depois). */
  onPauseRequested: (() => void) | null = null;

  constructor(opts: { startPaused?: boolean; breakpoints?: Iterable<string> } = {}) {
    this.startPause = opts.startPaused ?? false;
    this.breakpoints = new Set(opts.breakpoints ?? []);
  }

  get paused(): boolean {
    return this.waiter !== null;
  }

  requestPause(): void {
    if (this.paused) return;
    this.pauseRequested = true;
    this.onPauseRequested?.();
  }

  /** Continua até o próximo breakpoint (ou cancela um pedido de pausa ainda não atendido). */
  resume(): void {
    this.pauseRequested = false;
    this.stepArmed = false;
    this.release();
  }

  /** Executa um nó e pausa de novo. */
  step(): void {
    this.pauseRequested = false;
    this.stepArmed = true;
    this.release();
  }

  setBreakpoints(ids: Iterable<string>): void {
    this.breakpoints = new Set(ids);
  }

  private release(): void {
    const w = this.waiter;
    this.waiter = null;
    w?.();
  }

  /** Chamado pelo interpretador antes de cada nó. Resolve quando pode seguir (ou quando cancelam). */
  async gate(nodeId: string, signal: AbortSignal, hooks: { paused: (reason: PauseReason) => void; resumed: () => void }): Promise<void> {
    let reason: PauseReason | null = null;
    if (this.startPause) reason = "start";
    else if (this.stepArmed) reason = "step";
    else if (this.pauseRequested) reason = "user";
    else if (this.breakpoints.has(nodeId)) reason = "breakpoint";
    if (!reason) return;
    this.startPause = false;
    this.pauseRequested = false;
    this.stepArmed = false;
    hooks.paused(reason);
    await new Promise<void>((resolve) => {
      this.waiter = resolve;
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    this.waiter = null;
    if (!signal.aborted) hooks.resumed();
  }
}

/** Timeout global que NÃO corre enquanto a execução está pausada. */
export class Deadline {
  readonly controller = new AbortController();
  timedOut = false;
  private remaining: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;

  constructor(ms: number) {
    this.remaining = ms;
    this.resume();
  }

  pause(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.remaining -= Date.now() - this.startedAt;
  }

  resume(): void {
    if (this.timer || this.controller.signal.aborted) return;
    this.startedAt = Date.now();
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort(new Error("timeout"));
    }, Math.max(0, this.remaining));
    this.timer.unref?.();
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
