import { randomUUID } from "node:crypto";
import type {
  ActionOutcome,
  ActionProgress,
  ActionRequest,
  EngineStatus,
  ExecutionEvent,
  StartExecutionOptions,
  StartExecutionResult,
} from "@automation-studio/shared-types";
import { getNodeDefinition } from "@automation-studio/node-registry";
import {
  parseWorkflowDocument,
  type WorkflowDocument,
} from "@automation-studio/workflow-schema";
import {
  RunControl,
  runWorkflow,
  type ActionExecutor,
} from "@automation-studio/workflow-interpreter";
import {
  hasErrors,
  validateWorkflow,
} from "@automation-studio/workflow-validator";
import { AppError } from "./errors.js";
import type { HistoryService } from "./history.js";

/** O que o gerenciador precisa do motor (o EngineClient real satisfaz isto). */
export interface EngineLike {
  readonly status: EngineStatus;
  executeAction(
    req: ActionRequest,
    onProgress?: (p: ActionProgress) => void,
  ): Promise<ActionOutcome>;
  cancel(executionId: string): void;
  /** Fim da execução: o motor libera recursos (navegador aberto etc.). Opcional (dublês de teste). */
  endExecution?(executionId: string): void;
}

export interface ExecutionManagerDeps {
  engine: EngineLike;
  emit: (event: ExecutionEvent) => void;
  history: Pick<HistoryService, "begin" | "log" | "setStatus" | "finish">;
  /** Vínculo com o banco de automações: existência e versão salva idêntica ao fluxo executado. */
  workflows: {
    automationExists(automationId: string): boolean;
    matchingVersion(
      automationId: string,
      doc: WorkflowDocument,
    ): { id: number; number: number } | null;
  };
  /** Captura opcional da tela quando um nó falha (só se `captureEnabled()`); devolve o caminho do arquivo. */
  captureDiagnostic?: (
    executionId: string,
    nodeId: string,
  ) => Promise<string | null>;
  captureEnabled?: () => boolean;
  /** Chamado DEPOIS de o histórico gravar o fim (ex.: agendamento registra a última execução). */
  onFinished?: (executionId: string, status: string) => void;
  newId?: () => string;
}

const PAUSE_LABEL = {
  breakpoint: "breakpoint",
  step: "passo a passo",
  user: "pedido do usuário",
  start: "início",
} as const;

/** Uma execução por vez. Cada evento do interpretador vira também uma linha do histórico. */
export function createExecutionManager({
  engine,
  emit,
  history,
  workflows,
  captureDiagnostic,
  captureEnabled,
  onFinished,
  newId = randomUUID,
}: ExecutionManagerDeps) {
  let current: {
    executionId: string;
    controller: AbortController;
    control: RunControl;
    done: Promise<void>;
  } | null = null;

  const executor: ActionExecutor = {
    execute(req, { signal, onProgress }) {
      const outcome = engine.executeAction(req, onProgress); // registra a ação antes de qualquer cancelamento
      const cancel = () => engine.cancel(req.executionId);
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
      return outcome.finally(() => signal.removeEventListener("abort", cancel));
    },
  };

  const release = (executionId: string) => {
    if (current?.executionId === executionId) current = null;
  };
  const running = (executionId: string) => {
    if (!current || current.executionId !== executionId)
      throw new AppError(
        "NOT_FOUND",
        "Nenhuma execução em andamento com esse identificador.",
      );
    return current;
  };

  return {
    start(
      automationId: string,
      input: unknown,
      options: StartExecutionOptions = {},
      source?: { scheduleId: string },
    ): StartExecutionResult {
      const parsed = parseWorkflowDocument(input);
      if (!parsed.ok) throw new AppError("VALIDATION", parsed.message);
      const status = engine.status;
      if (status.state !== "ready") {
        const why =
          status.state === "unavailable"
            ? status.reason
            : "O motor ainda está iniciando; tente novamente em instantes.";
        throw new AppError(
          "ENGINE_UNAVAILABLE",
          `O motor de automação não está disponível. ${why}`,
        );
      }
      if (current)
        throw new AppError(
          "EXECUTION_BUSY",
          "Já há uma execução em andamento. Aguarde o fim ou cancele-a.",
        );
      if (!workflows.automationExists(automationId))
        throw new AppError("NOT_FOUND", "Automação não encontrada.");
      const errors = validateWorkflow(parsed.doc).filter(
        (i) => i.severity === "error",
      );
      if (hasErrors(errors)) {
        throw new AppError(
          "VALIDATION",
          `O fluxo tem ${errors.length} erro${errors.length > 1 ? "s" : ""} e não pode ser executado. ${errors[0]!.message}`,
        );
      }
      const mode = options.mode ?? (options.fromNodeId ? "from" : "run");
      if (mode === "from" && !options.fromNodeId)
        throw new AppError(
          "VALIDATION",
          "Informe a partir de qual nó executar.",
        );
      if (
        options.fromNodeId &&
        !parsed.doc.nodes.some((n) => n.id === options.fromNodeId)
      ) {
        throw new AppError(
          "VALIDATION",
          "O nó escolhido para iniciar não existe neste fluxo.",
        );
      }

      const doc = parsed.doc;
      const executionId = newId();
      const controller = new AbortController();
      const control = new RunControl({
        startPaused: mode === "step",
        breakpoints: options.breakpoints,
      });
      const version = workflows.matchingVersion(automationId, doc);
      history.begin({
        executionId,
        automationId,
        workflowVersionId: version?.id ?? null,
        document: doc,
        mode: source ? "scheduled" : mode,
      });

      const labels = new Map(
        doc.nodes.map((n) => [
          n.id,
          getNodeDefinition(n.type)?.label ?? n.type,
        ]),
      );
      const label = (id: string) => labels.get(id) ?? id;
      const pendingCaptures = new Set<Promise<void>>();
      const persist = (e: ExecutionEvent) => {
        switch (e.type) {
          case "execution_started":
            history.log(executionId, {
              level: "info",
              message: source ? "Execução iniciada pelo agendamento." : `Execução iniciada (${mode === "from" ? "a partir de um nó" : mode === "step" ? "passo a passo" : "normal"}).`,
              at: e.at,
            });
            break;
          case "node_completed":
            history.log(executionId, {
              level: "info",
              nodeId: e.nodeId,
              message: `${label(e.nodeId)}: concluído${e.message ? ` — ${e.message}` : ""}`,
              at: e.at,
            });
            break;
          case "node_failed": {
            const entry = {
              level: e.handled ? ("warn" as const) : ("error" as const),
              nodeId: e.nodeId,
              message: e.error.message,
              details: {
                code: e.error.code,
                ...(e.handled ? { handled: e.handled } : {}),
                ...(e.error.details ? { details: e.error.details } : {}),
              },
              at: e.at,
            };
            if (captureDiagnostic && captureEnabled?.()) {
              const p = captureDiagnostic(executionId, e.nodeId)
                .catch(() => null)
                .then((diagnosticPath) =>
                  history.log(executionId, {
                    ...entry,
                    ...(diagnosticPath ? { diagnosticPath } : {}),
                  }),
                )
                .finally(() => void pendingCaptures.delete(p));
              pendingCaptures.add(p);
            } else history.log(executionId, entry);
            break;
          }
          case "execution_paused":
            history.setStatus(executionId, "paused");
            history.log(executionId, {
              level: "info",
              nodeId: e.nodeId,
              message: `Pausada antes de "${e.label}" (${PAUSE_LABEL[e.reason]}).`,
              at: e.at,
            });
            break;
          case "execution_resumed":
            history.setStatus(executionId, "running");
            history.log(executionId, {
              level: "info",
              message: "Execução retomada.",
              at: e.at,
            });
            break;
          default:
            break;
        }
      };
      const safe = (fn: () => void, what: string) => {
        try {
          fn();
        } catch (err) {
          console.error(`[executions] falha ao ${what}`, err);
        }
      };

      /** O registro do fim (e o aviso `onFinished`) pode demorar (capturas de tela); `shutdown` espera por ele. */
      let finalizing: Promise<void> = Promise.resolve();
      const done = (async () => {
        try {
          await runWorkflow(doc, {
            executionId,
            executor,
            signal: controller.signal,
            control,
            mode,
            ...(options.fromNodeId ? { startAt: options.fromNodeId } : {}),
            ...(options.variables ? { variables: options.variables } : {}),
            onEvent: (e) => {
              // o histórico guarda o que aconteceu mesmo que a interface não esteja ouvindo
              if (e.type === "execution_finished") {
                // libera o motor ANTES de avisar o fim, para a interface poder iniciar a próxima execução
                release(executionId);
                safe(() => engine.endExecution?.(executionId), "avisar o motor do fim da execução"); // fecha o navegador etc.
                const finish = () =>
                  safe(() => {
                    history.log(executionId, {
                      level:
                        e.status === "failed"
                          ? "error"
                          : e.status === "completed_with_warnings"
                            ? "warn"
                            : "info",
                      message:
                        e.status === "failed"
                          ? `Execução falhou: ${e.error?.message ?? "erro desconhecido"}`
                          : e.status === "cancelled"
                            ? "Execução cancelada."
                            : e.status === "completed_with_warnings"
                              ? `Execução concluída com ${e.warnings ?? 0} aviso(s).`
                              : "Execução concluída.",
                      ...(e.failedNodeId ? { nodeId: e.failedNodeId } : {}),
                      at: e.at,
                    });
                    history.finish(executionId, {
                      status: e.status,
                      durationMs: e.durationMs,
                      ...(e.error ? { error: e.error } : {}),
                      ...(e.failedNodeId
                        ? { failedNodeId: e.failedNodeId }
                        : {}),
                      ...(e.warnings ? { warnings: e.warnings } : {}),
                      ...(e.snapshot ? { snapshot: e.snapshot } : {}),
                      at: e.at,
                    });
                  }, "gravar o fim no histórico");
                // espera as capturas de tela pendentes (no máximo 3 s) antes de fechar o registro
                const wait = pendingCaptures.size
                  ? Promise.race([
                      Promise.allSettled([...pendingCaptures]),
                      new Promise((r) => setTimeout(r, 3000)),
                    ])
                  : Promise.resolve();
                finalizing = wait.then(finish).then(() => safe(() => onFinished?.(executionId, e.status), "avisar o fim da execução"));
              } else safe(() => persist(e), "gravar no histórico");
              safe(() => emit(e), "emitir evento");
            },
          });
          await finalizing;
        } catch (err) {
          console.error("[executions] erro inesperado no interpretador", err);
        } finally {
          release(executionId);
        }
      })();
      current = { executionId, controller, control, done };
      return { executionId };
    },

    cancel(executionId: string): void {
      running(executionId).controller.abort();
    },
    pause(executionId: string): void {
      running(executionId).control.requestPause();
    },
    resume(executionId: string): void {
      running(executionId).control.resume();
    },
    step(executionId: string): void {
      running(executionId).control.step();
    },
    setBreakpoints(executionId: string, nodeIds: string[]): void {
      running(executionId).control.setBreakpoints(nodeIds);
    },

    isRunning: (): boolean => current !== null,

    /** Ao encerrar o app: cancela o que estiver rodando e resolve quando o interpretador terminou (o banco só fecha depois). */
    async shutdown(): Promise<void> {
      const c = current;
      if (!c) return;
      c.controller.abort();
      await Promise.race([c.done, new Promise((r) => setTimeout(r, 5000))]);
    },
  };
}
export type ExecutionManager = ReturnType<typeof createExecutionManager>;
