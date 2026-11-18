import { randomUUID } from "node:crypto";
import type { ExecutionEvent, EngineStatus, StartExecutionResult, ActionOutcome, ActionProgress, ActionRequest } from "@automation-studio/shared-types";
import { parseWorkflowDocument } from "@automation-studio/workflow-schema";
import { runWorkflow, type ActionExecutor } from "@automation-studio/workflow-interpreter";
import { hasErrors, validateWorkflow } from "@automation-studio/workflow-validator";
import { AppError } from "./errors.js";

/** O que o gerenciador precisa do motor (o EngineClient real satisfaz isto). */
export interface EngineLike {
  readonly status: EngineStatus;
  executeAction(req: ActionRequest, onProgress?: (p: ActionProgress) => void): Promise<ActionOutcome>;
  cancel(executionId: string): void;
}

export interface ExecutionManagerDeps {
  engine: EngineLike;
  emit: (event: ExecutionEvent) => void;
  newId?: () => string;
}

/** Fase 3: uma execução por vez. Histórico/persistência entram na Fase 5. */
export function createExecutionManager({ engine, emit, newId = randomUUID }: ExecutionManagerDeps) {
  let current: { executionId: string; controller: AbortController } | null = null;

  const executor: ActionExecutor = {
    execute(req, { signal, onProgress }) {
      const outcome = engine.executeAction(req, onProgress); // registra a ação antes de qualquer cancelamento
      const cancel = () => engine.cancel(req.executionId);
      if (signal.aborted) cancel();
      else signal.addEventListener("abort", cancel, { once: true });
      return outcome.finally(() => signal.removeEventListener("abort", cancel));
    },
  };

  return {
    start(input: unknown): StartExecutionResult {
      const parsed = parseWorkflowDocument(input);
      if (!parsed.ok) throw new AppError("VALIDATION", parsed.message);
      const status = engine.status;
      if (status.state !== "ready") {
        const why = status.state === "unavailable" ? status.reason : "O motor ainda está iniciando; tente novamente em instantes.";
        throw new AppError("ENGINE_UNAVAILABLE", `O motor de automação não está disponível. ${why}`);
      }
      if (current) throw new AppError("EXECUTION_BUSY", "Já há uma execução em andamento. Aguarde o fim ou cancele-a.");
      const errors = validateWorkflow(parsed.doc).filter((i) => i.severity === "error");
      if (hasErrors(errors)) {
        throw new AppError("VALIDATION", `O fluxo tem ${errors.length} erro${errors.length > 1 ? "s" : ""} e não pode ser executado. ${errors[0]!.message}`);
      }

      const executionId = newId();
      const controller = new AbortController();
      const slot = { executionId, controller };
      current = slot;
      const safeEmit = (e: ExecutionEvent) => {
        try {
          emit(e);
        } catch (err) {
          console.error("[executions] falha ao emitir evento", err);
        }
      };
      void runWorkflow(parsed.doc, { executionId, executor, onEvent: safeEmit, signal: controller.signal })
        .catch((err: unknown) => console.error("[executions] erro inesperado no interpretador", err))
        .finally(() => {
          if (current === slot) current = null;
        });
      return { executionId };
    },

    cancel(executionId: string): void {
      if (!current || current.executionId !== executionId) {
        throw new AppError("NOT_FOUND", "Nenhuma execução em andamento com esse identificador.");
      }
      current.controller.abort();
    },

    isRunning: (): boolean => current !== null,

    /** Ao encerrar o app: cancela o que estiver rodando. */
    shutdown(): void {
      current?.controller.abort();
    },
  };
}
export type ExecutionManager = ReturnType<typeof createExecutionManager>;
