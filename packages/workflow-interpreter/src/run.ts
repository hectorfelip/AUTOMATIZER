import { getNodeDefinition, type NodeDefinition } from "@automation-studio/node-registry";
import type {
  ActionOutcome,
  ActionProgress,
  ActionRequest,
  ExecutionError,
  ExecutionEvent,
  ExecutionStatus,
} from "@automation-studio/shared-types";
import type { WorkflowDocument, WorkflowNode } from "@automation-studio/workflow-schema";
import { hasErrors, validateWorkflow } from "@automation-studio/workflow-validator";
import { VARIABLE_NAME_PATTERN } from "@automation-studio/workflow-schema";
import { coerceToDeclared, evaluateCondition, OPERATOR_LABELS } from "./control.js";
import { createContext, resolveConfig, resolveItems } from "./resolve.js";

export interface ActionExecutor {
  /** Executa uma ação. Deve resolver (nunca rejeitar) e respeitar `signal` para cancelar. */
  execute(req: ActionRequest, ctl: { signal: AbortSignal; onProgress: (p: ActionProgress) => void }): Promise<ActionOutcome>;
}

export interface RunOptions {
  executionId: string;
  executor: ActionExecutor;
  onEvent: (event: ExecutionEvent) => void;
  /** Abortar = cancelar a execução. */
  signal?: AbortSignal;
  now?: () => Date;
  maxSteps?: number;
}

export interface RunResult {
  status: ExecutionStatus;
  error?: ExecutionError;
  durationMs: number;
}

/** Rede de segurança contra loop infinito; o timeout global é a outra. Alto de propósito: "Repetir" aceita até 100 000 voltas. */
export const DEFAULT_MAX_STEPS = 1_000_000;

/**
 * Percorre o grafo a partir do início, executa os nós e segue a porta de saída indicada pelo resultado.
 * Cada chamada tem seu próprio contexto (variáveis, nó atual, relógio); nada é compartilhado entre execuções.
 */
export async function runWorkflow(doc: WorkflowDocument, opts: RunOptions): Promise<RunResult> {
  const { executionId, executor, onEvent } = opts;
  const now = opts.now ?? (() => new Date());
  const startedAt = now().getTime();
  const at = () => now().toISOString();
  const emit = (e: ExecutionEvent) => onEvent(e);

  emit({ type: "execution_started", executionId, at: at(), workflowName: doc.name, nodeCount: doc.nodes.length });

  const finish = (status: ExecutionStatus, error?: ExecutionError, message?: string): RunResult => {
    const durationMs = now().getTime() - startedAt;
    emit({ type: "execution_finished", executionId, at: at(), status, durationMs, ...(error ? { error } : {}), ...(message ? { message } : {}) });
    return { status, durationMs, ...(error ? { error } : {}) };
  };

  // ---- 1. validação (o interpretador nunca executa um fluxo inválido) ----
  const issues = validateWorkflow(doc).filter((i) => i.severity === "error");
  if (hasErrors(issues)) {
    return finish("failed", {
      code: "INVALID_WORKFLOW",
      message: `O fluxo tem ${issues.length} erro${issues.length > 1 ? "s" : ""} e não pode ser executado. ${issues[0]!.message}`,
      details: { issues: issues.slice(0, 20) },
    });
  }

  // ---- 2. cancelamento e timeout global ----
  const timeoutMs = doc.settings.timeoutSeconds * 1000;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = opts.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal;
  const interrupted = (): RunResult | null => {
    if (!signal.aborted) return null;
    if (opts.signal?.aborted) return finish("cancelled", undefined, "Execução cancelada.");
    return finish("failed", { code: "TIMEOUT", message: `O fluxo excedeu o tempo limite de ${doc.settings.timeoutSeconds} s e foi interrompido.` });
  };

  // ---- 3. contexto isolado ----
  const nodes = new Map<string, WorkflowNode>(doc.nodes.map((n) => [n.id, n]));
  const next = new Map<string, string>(doc.edges.map((e) => [`${e.source}:${e.sourceHandle}`, e.target]));
  const ctx = createContext(doc);
  const variables = ctx.variables; // atalho: Definir variável altera o contexto desta execução
  const maxSteps = opts.maxSteps ?? DEFAULT_MAX_STEPS;
  const repeatCounters = new Map<string, number>(); // voltas já dadas por nó "Repetir" (isolado por execução)

  const invalid = (message: string): ActionOutcome => ({ kind: "failed", error: { code: "INVALID_CONFIG", message } });

  const setVariable = (node: WorkflowNode): ActionOutcome => {
    const name = node.config["name"];
    if (typeof name !== "string" || !VARIABLE_NAME_PATTERN.test(name)) return invalid("O nome da variável é inválido.");
    const resolved = resolveConfig({ value: node.config["value"] ?? "" }, ctx); // sem tipo: a referência pura mantém o tipo original
    if (!resolved.ok) return invalid(resolved.message);
    const raw = resolved.config["value"];
    const coerced = coerceToDeclared(name, raw === null ? "" : raw!, doc.variables[name]?.type);
    if (!coerced.ok) return invalid(coerced.message);
    variables[name] = coerced.value;
    return { kind: "completed", outputs: { [name]: coerced.value }, message: `Variável “${name}” = ${String(coerced.value)}.` };
  };

  const evaluate = (node: WorkflowNode): ActionOutcome => {
    const resolved = resolveConfig(node.config, ctx, { left: "text", right: "text" });
    if (!resolved.ok) return invalid(resolved.message);
    const left = String(resolved.config["left"] ?? "");
    const right = String(resolved.config["right"] ?? "");
    const operator = String(resolved.config["operator"] ?? "");
    const result = evaluateCondition(left, operator, right);
    if (!result.ok) return invalid(result.message);
    return { kind: "completed", outputs: { result: result.value }, next: result.value ? "true" : "false", message: `“${left}” ${OPERATOR_LABELS[operator]} “${right}”: ${result.value ? "verdadeiro" : "falso"}.` };
  };

  const repeat = (node: WorkflowNode): ActionOutcome => {
    const resolved = resolveConfig({ times: node.config["times"] ?? null }, ctx, { times: "number" });
    if (!resolved.ok) return invalid(resolved.message);
    const times = resolved.config["times"];
    if (typeof times !== "number" || !Number.isInteger(times) || times < 1 || times > 100_000) {
      return invalid("“Vezes” deve ser um número inteiro entre 1 e 100000.");
    }
    const done = repeatCounters.get(node.id) ?? 0;
    if (done < times) {
      repeatCounters.set(node.id, done + 1);
      return { kind: "completed", outputs: { iteration: done + 1 }, next: "body", message: `Repetição ${done + 1} de ${times}.` };
    }
    repeatCounters.delete(node.id); // pronto para uma próxima passagem (ex.: laço dentro de outro laço)
    return { kind: "completed", outputs: { iterations: times }, next: "done", message: `${times} repetição(ões) concluída(s).` };
  };

  /** Lista, posição e nome do item de cada "Para cada item" em andamento. */
  const foreachState = new Map<string, { items: unknown[]; next: number }>();
  const dropScope = (nodeId: string) => {
    const i = ctx.loops.findIndex((l) => l.nodeId === nodeId);
    if (i >= 0) ctx.loops.splice(i, 1);
  };

  const foreach = (node: WorkflowNode): ActionOutcome => {
    let state = foreachState.get(node.id);
    if (!state) {
      const resolved = resolveItems(node.config["items"], ctx); // a lista é lida UMA vez, na primeira passagem
      if (!resolved.ok) return invalid(resolved.message);
      state = { items: resolved.items, next: 0 };
      foreachState.set(node.id, state);
    }
    const count = state.items.length;
    if (state.next >= count) {
      foreachState.delete(node.id);
      dropScope(node.id);
      return { kind: "completed", outputs: { count }, next: "done", message: count === 0 ? "A lista está vazia; nada a repetir." : `${count} item(ns) processado(s).` };
    }
    const index = ++state.next; // posição 1-based
    const name = typeof node.config["itemName"] === "string" && node.config["itemName"] ? node.config["itemName"] : "item";
    const scope = { nodeId: node.id, name, item: state.items[index - 1], index, count };
    const at = ctx.loops.findIndex((l) => l.nodeId === node.id);
    if (at >= 0) ctx.loops[at] = scope; // próxima volta: troca o item, mantendo a ordem de aninhamento
    else ctx.loops.push(scope);
    return { kind: "completed", outputs: { index, count }, next: "body", message: `Item ${index} de ${count}.` };
  };

  let current: string | undefined = doc.nodes.find((n) => n.type === "trigger.manual")!.id;
  for (let steps = 0; current !== undefined; steps++) {
    const stop = interrupted();
    if (stop) return stop;
    if (steps >= maxSteps) {
      return finish("failed", { code: "LOOP_LIMIT", message: `O fluxo executou mais de ${maxSteps} passos. Verifique se há um loop sem saída.` });
    }

    const node: WorkflowNode = nodes.get(current)!;
    const def: NodeDefinition = getNodeDefinition(node.type)!;
    emit({ type: "node_started", executionId, at: at(), nodeId: node.id, nodeType: node.type, label: def.label });

    let outcome: ActionOutcome;
    if (node.type === "trigger.manual") {
      outcome = { kind: "completed", outputs: {} };
    } else if (node.type === "flow.end") {
      const message = typeof node.config["message"] === "string" && node.config["message"] ? node.config["message"] : undefined;
      emit({ type: "node_completed", executionId, at: at(), nodeId: node.id, port: null, ...(message ? { message } : {}) });
      return finish("completed", undefined, message);
    } else if (node.type === "data.set_variable") {
      outcome = setVariable(node);
    } else if (node.type === "flow.condition") {
      outcome = evaluate(node);
    } else if (node.type === "flow.repeat") {
      outcome = repeat(node);
    } else if (node.type === "flow.foreach") {
      outcome = foreach(node);
    } else {
      const resolved = resolveConfig(node.config, ctx, Object.fromEntries(def.fields.map((f) => [f.key, f.kind])));
      if (!resolved.ok) {
        outcome = { kind: "failed", error: { code: "INVALID_CONFIG", message: resolved.message } };
      } else {
        const req: ActionRequest = { executionId, nodeId: node.id, action: node.type, config: resolved.config };
        try {
          outcome = await executor.execute(req, {
            signal,
            onProgress: (p) => emit({ type: "node_progress", executionId, at: at(), nodeId: node.id, ...p }),
          });
        } catch (err) {
          outcome = { kind: "failed", error: { code: "INTERNAL_ERROR", message: "Falha inesperada ao executar o nó.", details: { message: (err as Error).message } } };
        }
      }
    }

    if (outcome.kind === "cancelled") {
      return interrupted() ?? finish("cancelled", undefined, "Execução cancelada.");
    }
    const stop2 = interrupted(); // cancelou/estourou enquanto a ação terminava
    if (stop2) return stop2;

    const outs: string[] = def.outputs.map((o) => o.id);
    if (outcome.kind === "completed") {
      ctx.nodes.set(node.id, outcome.outputs); // disponível para os nós seguintes: {{nodes.<id>.<resultado>}}
      const port: string | null = outcome.next ?? (outs.includes("success") ? "success" : outs.includes("next") ? "next" : null);
      if (port !== null && !outs.includes(port)) {
        const error = { code: "INVALID_ACTION_RESULT", message: `${def.label}: a ação indicou uma saída inexistente (“${port}”).` };
        emit({ type: "node_failed", executionId, at: at(), nodeId: node.id, error });
        return finish("failed", error);
      }
      emit({ type: "node_completed", executionId, at: at(), nodeId: node.id, port, ...(outcome.message ? { message: outcome.message } : {}) });
      current = port === null ? undefined : next.get(`${node.id}:${port}`);
      continue;
    }

    // falhou: segue o caminho de erro se o fluxo previu um; senão, para (política "stop")
    emit({ type: "node_failed", executionId, at: at(), nodeId: node.id, error: outcome.error });
    const handler = outs.includes("error") ? next.get(`${node.id}:error`) : undefined;
    if (handler === undefined) return finish("failed", { ...outcome.error, message: `${def.label}: ${outcome.error.message}` });
    current = handler;
  }

  // a saída seguida não tem conexão: o fluxo termina ali (fim implícito)
  return finish("completed");
}
