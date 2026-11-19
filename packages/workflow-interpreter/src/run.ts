import { getNodeDefinition, type NodeDefinition } from "@automation-studio/node-registry";
import type {
  ActionOutcome,
  ContextSnapshot,
  ExecutionMode,
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
import { createContext, resolveConfig, resolveItems, type Scalar } from "./resolve.js";
import { Deadline, type RunControl } from "./run-control.js";
import { buildSnapshot } from "./snapshot.js";

export interface ActionExecutor {
  /** Executa uma ação. Deve resolver (nunca rejeitar) e respeitar `signal` para cancelar. */
  execute(req: ActionRequest, ctl: { signal: AbortSignal; onProgress: (p: ActionProgress) => void }): Promise<ActionOutcome>;
}

/** Resultado de procurar o fluxo a chamar (quem chama decide de onde ele vem; o interpretador só executa). */
export type SubflowLookup = { ok: true; doc: WorkflowDocument; name: string } | { ok: false; code: string; message: string };
export interface SubflowProvider {
  load(automationId: string): SubflowLookup;
}

/** Máximo de fluxos encadeados (A chama B chama C…), contando o principal. */
export const MAX_SUBFLOW_DEPTH = 5;

/** Preenchido só quando este fluxo roda DENTRO de outro (nó "Chamar fluxo"). */
export interface NestInfo {
  /** Caminho do nó "Chamar fluxo" a partir do fluxo principal (`a/b`): prefixo dos ids de nó para breakpoints e passo a passo. */
  prefix: string;
  calleeName: string;
  /** Ids de automação já na cadeia de chamadas (detecta ciclo). */
  callStack: string[];
  /** Prazos dos fluxos de fora: parados junto quando a execução pausa (tempo pausado não conta para nenhum). */
  pauseWith: Deadline[];
}

export interface RunOptions {
  executionId: string;
  executor: ActionExecutor;
  onEvent: (event: ExecutionEvent) => void;
  /** Abortar = cancelar a execução. */
  signal?: AbortSignal;
  now?: () => Date;
  maxSteps?: number;
  /** Pausa, passo a passo e breakpoints. */
  control?: RunControl;
  /** Começa neste nó (em vez de no início manual). */
  startAt?: string;
  /** Valores iniciais das variáveis (sobrepõem os do fluxo). */
  variables?: Record<string, Scalar>;
  mode?: ExecutionMode;
  /** Sobrescreve o timeout do fluxo (testes). */
  timeoutMs?: number;
  /** De onde vêm os fluxos chamados; sem isto, "Chamar fluxo" falha com mensagem clara. */
  subflows?: SubflowProvider;
  nest?: NestInfo;
}

export interface RunResult {
  status: ExecutionStatus;
  error?: ExecutionError;
  durationMs: number;
  /** Variáveis no fim (o "retorno" de um fluxo chamado por outro). */
  variables?: Record<string, Scalar>;
  /** Nó que causou a falha que encerrou o fluxo. */
  failedNodeId?: string;
  warnings?: number;
}

/** Rede de segurança contra loop infinito; o timeout global é a outra. Alto de propósito: "Repetir" aceita até 100 000 voltas. */
export const DEFAULT_MAX_STEPS = 1_000_000;

/**
 * Erros de AÇÃO podem ser ignorados na política "continuar". Nunca os de infraestrutura (motor, timeout)
 * nem os de configuração/bug: continuar neles só repetiria o problema ou esconderia um defeito.
 */
const NEVER_CONTINUE = new Set(["ENGINE_CRASHED", "ENGINE_UNAVAILABLE", "TIMEOUT", "INTERNAL_ERROR", "INVALID_CONFIG", "INVALID_ACTION_RESULT", "LOOP_LIMIT", "INVALID_WORKFLOW"]);
export const isContinuable = (code: string): boolean => !NEVER_CONTINUE.has(code);

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

  emit({
    type: "execution_started",
    executionId,
    at: at(),
    workflowName: doc.name,
    nodeCount: doc.nodes.length,
    mode: opts.mode ?? (opts.startAt ? "from" : opts.control ? "step" : "run"),
    ...(opts.startAt ? { startNodeId: opts.startAt } : {}),
  });

  let warnings = 0;
  let deadline: Deadline | null = null;
  let snapshotNow: (() => ContextSnapshot) | null = null;
  let finalVariables: (() => Record<string, Scalar>) | null = null;
  const finish = (status: ExecutionStatus, error?: ExecutionError, message?: string, failedNodeId?: string): RunResult => {
    deadline?.dispose();
    const durationMs = now().getTime() - startedAt;
    const final: ExecutionStatus = status === "completed" && warnings > 0 ? "completed_with_warnings" : status;
    const note = final === "completed_with_warnings" ? `${warnings} nó(s) falharam e foram ignorados.${message ? ` ${message}` : ""}` : message;
    emit({
      type: "execution_finished",
      executionId,
      at: at(),
      status: final,
      durationMs,
      ...(error ? { error } : {}),
      ...(note ? { message: note } : {}),
      ...(failedNodeId ? { failedNodeId } : {}),
      ...(warnings ? { warnings } : {}),
      ...(snapshotNow ? { snapshot: snapshotNow() } : {}),
    });
    return { status: final, durationMs, ...(error ? { error } : {}), ...(failedNodeId ? { failedNodeId } : {}), ...(warnings ? { warnings } : {}), ...(finalVariables ? { variables: finalVariables() } : {}) };
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
  deadline = new Deadline(opts.timeoutMs ?? doc.settings.timeoutSeconds * 1000);
  const dl = deadline;
  const signal = opts.signal ? AbortSignal.any([opts.signal, dl.controller.signal]) : dl.controller.signal;
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
  snapshotNow = () => buildSnapshot(ctx);
  finalVariables = () => ({ ...variables });
  for (const [name, raw] of Object.entries(opts.variables ?? {})) {
    const coerced = coerceToDeclared(name, raw, doc.variables[name]?.type);
    if (!coerced.ok) return finish("failed", { code: "INVALID_CONFIG", message: `Valor inicial inválido: ${coerced.message}` });
    variables[name] = coerced.value;
  }
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

  /** "Chamar fluxo": roda a versão salva de outra automação aqui dentro, com as variáveis dela como parâmetros. */
  const callSubflow = async (node: WorkflowNode): Promise<ActionOutcome> => {
    const targetId = node.config["automationId"];
    if (typeof targetId !== "string" || targetId === "") return invalid("Escolha o fluxo a chamar.");
    if (!opts.subflows) return invalid("Este ambiente não permite chamar outros fluxos.");
    const stack = opts.nest?.callStack ?? [doc.id];
    if (stack.includes(targetId)) {
      return { kind: "failed", error: { code: "SUBFLOW_CYCLE", message: "Chamada em ciclo: este fluxo já está na cadeia de chamadas e chamá-lo de novo nunca terminaria." } };
    }
    if (stack.length >= MAX_SUBFLOW_DEPTH) {
      return { kind: "failed", error: { code: "SUBFLOW_DEPTH", message: `Fluxos chamados demais em cadeia (máximo ${MAX_SUBFLOW_DEPTH}).` } };
    }
    const found = opts.subflows.load(targetId);
    if (!found.ok) return { kind: "failed", error: { code: found.code, message: found.message } };

    // parâmetros: `arg.<variável>`; cada um precisa existir no fluxo chamado
    const rawArgs: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(node.config)) if (k.startsWith("arg.") && k.length > 4) rawArgs[k] = v;
    const resolved = resolveConfig(rawArgs, ctx, Object.fromEntries(Object.keys(rawArgs).map((k) => [k, "text" as const])));
    if (!resolved.ok) return invalid(resolved.message);
    const args: Record<string, Scalar> = {};
    for (const [k, v] of Object.entries(resolved.config)) {
      const name = k.slice(4);
      if (!Object.prototype.hasOwnProperty.call(found.doc.variables, name)) {
        return invalid(`O fluxo “${found.name}” não tem a variável “${name}”. Atualize os parâmetros deste nó.`);
      }
      if (v === null || v === "") continue; // vazio = manter o valor padrão do fluxo chamado
      args[name] = v as Scalar;
    }

    const wrap = (e: ExecutionEvent): void => {
      if (e.type === "execution_started" || e.type === "execution_finished") return; // o fluxo de fora é quem começa e termina
      const named = "nodeId" in e && typeof e.nodeId === "string" ? { ...e, nodeId: `${node.id}/${e.nodeId}` } : e;
      if (named.type === "node_started") emit({ ...named, label: `${found.name} › ${named.label}` });
      else if (named.type === "execution_paused") emit({ ...named, label: `${found.name} › ${named.label}` });
      else emit(named);
    };
    const inner = await runWorkflow(found.doc, {
      executionId,
      executor,
      onEvent: wrap,
      signal,
      ...(opts.control ? { control: opts.control } : {}),
      now,
      variables: args,
      subflows: opts.subflows,
      nest: { prefix: opts.nest ? `${opts.nest.prefix}/${node.id}` : node.id, calleeName: found.name, callStack: [...stack, targetId], pauseWith: [...(opts.nest?.pauseWith ?? []), dl] },
    });
    if (inner.status === "cancelled") return { kind: "cancelled" };
    if (inner.status === "failed") {
      const where = inner.failedNodeId ? ` (nó ${inner.failedNodeId})` : "";
      const code = inner.error?.code ?? "SUBFLOW_FAILED";
      return { kind: "failed", error: { code: isContinuable(code) ? "SUBFLOW_FAILED" : code, message: `O fluxo “${found.name}” falhou${where}: ${inner.error?.message ?? "erro desconhecido"}`, ...(inner.error?.details ? { details: inner.error.details } : {}) } };
    }
    if (inner.status === "completed_with_warnings") warnings++;
    return {
      kind: "completed",
      outputs: { outputs: { ...(inner.variables ?? {}) }, status: inner.status },
      message: `Fluxo “${found.name}” ${inner.status === "completed_with_warnings" ? "concluído com avisos" : "concluído"}.`,
    };
  };

  if (opts.startAt !== undefined && !nodes.has(opts.startAt)) {
    return finish("failed", { code: "INVALID_WORKFLOW", message: "O nó escolhido para começar não existe neste fluxo." });
  }
  let current: string | undefined = opts.startAt ?? doc.nodes.find((n) => n.type === "trigger.manual")!.id;
  if (opts.control && !opts.nest) { // dentro de um fluxo chamado, quem avisa o pedido de pausa é o fluxo de fora
    opts.control.onPauseRequested = () => emit({ type: "execution_pause_requested", executionId, at: at(), nodeId: current ?? null });
  }
  for (let steps = 0; current !== undefined; steps++) {
    const stop = interrupted();
    if (stop) return stop;
    if (steps >= maxSteps) {
      return finish("failed", { code: "LOOP_LIMIT", message: `O fluxo executou mais de ${maxSteps} passos. Verifique se há um loop sem saída.` });
    }
    if (opts.control) {
      const at0 = current;
      // breakpoints/passo usam o caminho completo (`sub/w` dentro de um fluxo chamado)
      await opts.control.gate(opts.nest ? `${opts.nest.prefix}/${at0}` : at0, signal, {
        paused: (reason) => {
          dl.pause(); // o tempo parado não conta para o timeout (nem o dos fluxos de fora, se este é um fluxo chamado)
          for (const d of opts.nest?.pauseWith ?? []) d.pause();
          emit({ type: "execution_paused", executionId, at: at(), nodeId: at0, label: getNodeDefinition(nodes.get(at0)!.type)?.label ?? at0, reason, snapshot: buildSnapshot(ctx) });
        },
        resumed: () => {
          dl.resume();
          for (const d of opts.nest?.pauseWith ?? []) d.resume();
          emit({ type: "execution_resumed", executionId, at: at() });
        },
      });
      const stopped = interrupted(); // cancelado enquanto pausado
      if (stopped) return stopped;
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
    } else if (node.type === "flow.subflow") {
      outcome = await callSubflow(node);
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
        return finish("failed", error, undefined, node.id);
      }
      emit({ type: "node_completed", executionId, at: at(), nodeId: node.id, port, ...(outcome.message ? { message: outcome.message } : {}) });
      current = port === null ? undefined : next.get(`${node.id}:${port}`);
      continue;
    }

    // falhou: (1) segue a saída "Erro" se o fluxo previu uma; (2) na política "continuar", segue pela saída normal
    // e a execução termina "com avisos"; (3) senão, para.
    const handler = outs.includes("error") ? next.get(`${node.id}:error`) : undefined;
    if (handler !== undefined) {
      emit({ type: "node_failed", executionId, at: at(), nodeId: node.id, error: outcome.error, handled: "error_branch" });
      current = handler;
      continue;
    }
    const normal = outs.includes("success") ? "success" : outs.includes("next") ? "next" : null;
    if (doc.settings.errorPolicy === "continue" && normal !== null && isContinuable(outcome.error.code)) {
      warnings++;
      emit({ type: "node_failed", executionId, at: at(), nodeId: node.id, error: outcome.error, handled: "continued" });
      current = next.get(`${node.id}:${normal}`);
      continue;
    }
    emit({ type: "node_failed", executionId, at: at(), nodeId: node.id, error: outcome.error });
    return finish("failed", { ...outcome.error, message: `${def.label}: ${outcome.error.message}` }, undefined, node.id);
  }

  // a saída seguida não tem conexão: o fluxo termina ali (fim implícito)
  return finish("completed");
}
