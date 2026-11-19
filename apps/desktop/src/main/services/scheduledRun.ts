/** Argumentos com que o Agendador de Tarefas chama o app. Formato estrito: nada além de ids simples. */
export interface LaunchRun {
  automationId: string;
  scheduleId: string | null;
}

const ID = /^[A-Za-z0-9_-]{1,100}$/;

export function parseLaunchArgs(argv: readonly string[]): LaunchRun | null {
  let automationId: string | null = null;
  let scheduleId: string | null = null;
  for (const a of argv) {
    const m = /^--(run-automation|schedule)=(.*)$/.exec(a);
    if (!m) continue;
    if (!ID.test(m[2]!)) return null; // argumento malformado: ignora tudo (nunca executa "meio certo")
    if (m[1] === "run-automation") automationId = m[2]!;
    else scheduleId = m[2]!;
  }
  return automationId ? { automationId, scheduleId } : null;
}

interface Deps {
  /** Espera o motor ficar pronto (ou desiste). */
  waitEngineReady(): Promise<boolean>;
  isRunning(): boolean;
  loadSaved(automationId: string): { document: unknown; version: number };
  automationStatus(automationId: string): "active" | "archived" | null;
  scheduleEnabled(scheduleId: string): boolean | null;
  start(automationId: string, doc: unknown, scheduleId: string): { executionId: string };
  /** Registra no agendamento o que aconteceu quando nem chegou a executar. */
  recordSkipped(scheduleId: string, why: string): void;
  log(message: string): void;
}

export type LaunchOutcome = "started" | "skipped";

/** Executa uma automação a pedido do agendador. Nunca lança; sempre diz se rodou ou por que não. */
export function createScheduledRunner(d: Deps) {
  return {
    async run({ automationId, scheduleId }: LaunchRun): Promise<LaunchOutcome> {
      const skip = (why: string, status: string): LaunchOutcome => {
        d.log(`agendamento ignorado: ${why}`);
        if (scheduleId) d.recordSkipped(scheduleId, status);
        return "skipped";
      };
      if (scheduleId && d.scheduleEnabled(scheduleId) === false) return skip("agendamento desativado", "skipped_disabled");
      const st = d.automationStatus(automationId);
      if (st === null) return skip("automação não existe mais", "skipped_missing");
      if (st === "archived") return skip("automação arquivada", "skipped_archived");
      if (!(await d.waitEngineReady())) return skip("motor indisponível", "failed_engine");
      if (d.isRunning()) return skip("já há uma execução em andamento", "skipped_busy");
      try {
        const { document, version } = d.loadSaved(automationId);
        if (version === 0) return skip("fluxo nunca salvo", "skipped_unsaved");
        d.start(automationId, document, scheduleId ?? "manual");
        return "started";
      } catch (err) {
        return skip(err instanceof Error ? err.message : "erro ao iniciar", "failed_start");
      }
    },
  };
}
