import { getNodeDefinition, type ConfigField, type NodeDefinition } from "@automation-studio/node-registry";
import {
  VARIABLE_NAME_PATTERN,
  type ConfigValue,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowNode,
} from "@automation-studio/workflow-schema";
import { buildGraph, knownVariables, resultOf, type Graph } from "./graph.js";
import { hasTemplate, scanTemplate, type Ref, type TemplateScan } from "./templates.js";
import type { Issue } from "./types.js";

const START_TYPE = "trigger.manual";
const isBlank = (v: ConfigValue | undefined): boolean => v === undefined || v === null || (typeof v === "string" && v.trim() === "");

interface Ctx {
  known: Set<string>;
  graph: Graph;
}

const INDEX = /^\d+$/;

type Emit = (f: ConfigField, severity: Issue["severity"], code: Issue["code"], msg: string) => void;

/** Valida cada `{{ }}` de um campo: a variável/nó/resultado/item existe? (a ordem de execução só gera aviso). */
function validateRefs(scan: TemplateScan, node: WorkflowNode, f: ConfigField, ctx: Ctx, emit: Emit): void {
  for (const ref of scan.refs as Ref[]) {
    if (ref.kind === "variables") {
      if (!ctx.known.has(ref.name)) emit(f, "error", "UNKNOWN_VARIABLE", `“${f.label}” usa a variável “${ref.name}”, que não está definida.`);
    } else if (ref.kind === "nodes") {
      const target = ctx.graph.nodes.get(ref.nodeId);
      if (!target) {
        emit(f, "error", "UNKNOWN_NODE_REF", `“${f.label}” usa o resultado do nó “${ref.nodeId}”, que não existe.`);
        continue;
      }
      const tdef = getNodeDefinition(target.type);
      const label = tdef?.label ?? target.type;
      if (target.id === node.id) {
        emit(f, "error", "SELF_REFERENCE", `“${f.label}” não pode usar o resultado do próprio nó.`);
        continue;
      }
      const res = tdef?.results?.find((r) => r.key === ref.key);
      if (!res) {
        const avail = (tdef?.results ?? []).map((r) => r.key);
        emit(f, "error", "UNKNOWN_RESULT", `“${f.label}” usa “${ref.key}”, que o nó “${label}” não oferece. ${avail.length ? `Disponíveis: ${avail.join(", ")}.` : "Esse nó não oferece resultados."}`);
        continue;
      }
      const [first, second] = ref.path;
      if (first !== undefined) {
        if (res.type === "list") {
          if (!INDEX.test(first)) emit(f, "error", "NOT_A_LIST", `“${ref.key}” é uma lista: use a posição (ex.: {{nodes.${ref.nodeId}.${ref.key}.0}}) ou o nó “Para cada item”.`);
          else if (second !== undefined && res.itemProps && !res.itemProps.includes(second)) {
            emit(f, "error", "UNKNOWN_ITEM_PROPERTY", `Os itens de “${ref.key}” não têm “${second}”. Disponíveis: ${res.itemProps.join(", ")}.`);
          }
        } else if (res.type !== "object") {
          emit(f, "error", "UNKNOWN_RESULT", `“${ref.key}” é um valor simples e não tem “${first}”.`);
        }
      } else if (res.type === "list" && f.kind !== "list") {
        emit(f, "error", "NOT_A_LIST", `“${ref.key}” é uma lista e não cabe em “${f.label}”. Use “Para cada item” para percorrê-la, ou uma posição (ex.: …${ref.key}.0.name).`);
      }
      if (!ctx.graph.reaches(target.id, node.id)) {
        emit(f, "warning", "NODE_NOT_BEFORE", `“${f.label}” usa o resultado de “${label}”, mas esse nó pode não ter sido executado antes deste.`);
      }
    } else {
      const loops = ctx.graph.loopsAt(node.id).filter((l) => l.name === ref.name);
      if (loops.length === 0) {
        emit(f, "error", "UNKNOWN_LOOP_VARIABLE", `“${f.label}” usa “${ref.name}”, que só existe dentro do corpo de um “Para cada item”.`);
        continue;
      }
      const props = loops[0]!.itemProps;
      const prop = ref.path[0];
      if (props && prop !== undefined && !props.includes(prop)) {
        emit(f, "error", "UNKNOWN_ITEM_PROPERTY", `O item “${ref.name}” não tem “${prop}”. Disponíveis: ${props.join(", ")}.`);
      }
    }
  }
}

/** Valida parâmetros de um nó contra os campos do seu contrato. */
function validateConfig(node: WorkflowNode, def: NodeDefinition, ctx: Ctx): Issue[] {
  const issues: Issue[] = [];
  const emit: Emit = (f, severity, code, msg) => {
    issues.push({ severity, code, message: `${def.label}: ${msg}`, nodeId: node.id, field: f.key });
  };
  const at = (f: ConfigField, code: Issue["code"], msg: string): void => emit(f, "error", code, msg);

  for (const f of def.fields) {
    const v = node.config[f.key];
    if (isBlank(v)) {
      if (f.required) at(f, "REQUIRED_FIELD", `o campo “${f.label}” é obrigatório.`);
      continue;
    }
    const isText = typeof v === "string";
    const templated = isText && hasTemplate(v);

    if (templated) {
      const scan = scanTemplate(v);
      for (const e of scan.errors) at(f, "BAD_EXPRESSION", `“${f.label}”: ${e}`);
      validateRefs(scan, node, f, ctx, emit);
      if (f.kind === "select" || f.literal) at(f, "INVALID_FIELD", `“${f.label}” não aceita variáveis; informe um valor fixo.`);
      if (f.kind === "list") {
        const w = scan.whole;
        if (scan.errors.length === 0 && (w?.kind !== "nodes" || w.path.length > 0)) {
          at(f, "NOT_A_LIST", `“${f.label}” deve ser só a referência a uma lista, ex.: {{nodes.listar.files}}.`);
        } else if (w?.kind === "nodes") {
          const res = resultOf(ctx.graph.nodes, w.nodeId, w.key);
          if (res && res.type !== "list") at(f, "NOT_A_LIST", `“${w.key}” não é uma lista (é ${res.type === "number" ? "um número" : res.type === "boolean" ? "um valor lógico" : "um texto"}).`);
        }
      }
      continue; // valor só é conhecido na execução
    }

    switch (f.kind) {
      case "list":
        at(f, "NOT_A_LIST", `“${f.label}” deve ser a referência a uma lista, ex.: {{nodes.listar.files}}; texto fixo não é uma lista.`);
        break;
      case "number":
        if (typeof v !== "number" || !Number.isFinite(v)) at(f, "INVALID_FIELD", `“${f.label}” deve ser um número.`);
        else if (f.min !== undefined && v < f.min) at(f, "INVALID_FIELD", `“${f.label}” deve ser no mínimo ${f.min}.`);
        else if (f.max !== undefined && v > f.max) at(f, "INVALID_FIELD", `“${f.label}” deve ser no máximo ${f.max}.`);
        break;
      case "boolean":
        if (typeof v !== "boolean") at(f, "INVALID_FIELD", `“${f.label}” deve ser verdadeiro ou falso.`);
        break;
      case "select":
        if (!f.options?.some((o) => o.value === v)) at(f, "INVALID_FIELD", `“${f.label}” tem uma opção inválida.`);
        break;
      default: // text | path
        if (!isText) at(f, "INVALID_FIELD", `“${f.label}” deve ser um texto.`);
        else if (f.pattern && !new RegExp(f.pattern).test(v)) {
          at(f, "INVALID_FIELD", `“${f.label}”: ${f.patternMessage ?? "formato inválido."}`);
        }
    }
  }
  return issues;
}

/** Quantas saídas "normais" (fora `error`) o nó tem: ≥2 = o fluxo pode decidir sair de um ciclo. */
const isBranching = (def: NodeDefinition): boolean => def.outputs.filter((o) => o.id !== "error").length >= 2;

/** Valida estrutura, conexões, parâmetros e variáveis de um workflow. Não lança nem altera o documento. */
export function validateWorkflow(doc: WorkflowDocument): Issue[] {
  const issues: Issue[] = [];
  const nodes = new Map<string, WorkflowNode>();
  const defs = new Map<string, NodeDefinition>();

  // ---- variáveis declaradas ----
  const known = knownVariables(doc); // declaradas + definidas por "Definir variável"
  const ctx: Ctx = { known, graph: buildGraph(doc) };
  for (const [name, v] of Object.entries(doc.variables)) {
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      issues.push({ severity: "error", code: "INVALID_VARIABLE", message: `Variável “${name}”: nome inválido (use letras, números e _).` });
    }
    if (typeof v.value !== v.type) {
      issues.push({ severity: "error", code: "INVALID_VARIABLE", message: `Variável “${name}”: o valor não é do tipo ${v.type}.` });
    }
  }
  // ---- nós ----
  for (const n of doc.nodes) {
    if (nodes.has(n.id)) {
      issues.push({ severity: "error", code: "DUPLICATE_NODE_ID", message: `Identificador de nó repetido: ${n.id}.`, nodeId: n.id });
      continue;
    }
    nodes.set(n.id, n);
    const def = getNodeDefinition(n.type);
    if (!def) {
      issues.push({ severity: "error", code: "UNKNOWN_NODE_TYPE", message: `Tipo de nó desconhecido: ${n.type}.`, nodeId: n.id });
      continue;
    }
    defs.set(n.id, def);
    if (n.version !== def.version) {
      issues.push({ severity: "error", code: "UNSUPPORTED_NODE_VERSION", message: `${def.label}: versão ${n.version} do nó não é suportada (esperada ${def.version}).`, nodeId: n.id });
      continue;
    }
    issues.push(...validateConfig(n, def, ctx));
  }

  // ---- início e nós únicos ----
  const starts = doc.nodes.filter((n) => n.type === START_TYPE);
  if (starts.length === 0) {
    issues.push({ severity: "error", code: "NO_START", message: "O fluxo não tem um nó “Início manual”." });
  }
  for (const def of new Set(defs.values())) {
    if (!def.unique) continue;
    const same = doc.nodes.filter((n) => n.type === def.type);
    for (const n of same.slice(1)) {
      issues.push({ severity: "error", code: "DUPLICATE_UNIQUE_NODE", message: `Só pode haver um “${def.label}” no fluxo.`, nodeId: n.id });
    }
  }

  // ---- conexões ----
  const seenEdges = new Set<string>();
  const usedOutputs = new Set<string>();
  const valid: WorkflowEdge[] = [];
  for (const e of doc.edges) {
    const err = (code: Issue["code"], message: string): void => void issues.push({ severity: "error", code, message, edgeId: e.id });
    if (seenEdges.has(e.id)) {
      err("DUPLICATE_EDGE_ID", `Conexão repetida: ${e.id}.`);
      continue;
    }
    seenEdges.add(e.id);
    const from = nodes.get(e.source);
    const to = nodes.get(e.target);
    if (!from || !to) {
      err("EDGE_UNKNOWN_NODE", "Há uma conexão ligada a um nó que não existe.");
      continue;
    }
    const fromDef = defs.get(from.id);
    const toDef = defs.get(to.id);
    if (!fromDef || !toDef) continue; // tipo desconhecido já reportado
    const label = (n: WorkflowNode, d: NodeDefinition): string => `“${d.label}” (${n.id})`;
    if (!fromDef.outputs.some((p) => p.id === e.sourceHandle)) {
      err("EDGE_UNKNOWN_PORT", `${label(from, fromDef)} não tem a saída “${e.sourceHandle}”.`);
      continue;
    }
    if (!toDef.inputs.some((p) => p.id === e.targetHandle)) {
      err("EDGE_UNKNOWN_PORT", `${label(to, toDef)} não tem a entrada “${e.targetHandle}”.`);
      continue;
    }
    if (e.source === e.target) {
      err("EDGE_SELF_LOOP", `${label(from, fromDef)} está ligado a si mesmo.`);
      continue;
    }
    const key = `${e.source}:${e.sourceHandle}`;
    if (usedOutputs.has(key)) {
      err("OUTPUT_ALREADY_CONNECTED", `A saída “${e.sourceHandle}” de ${label(from, fromDef)} já está conectada; cada saída segue um único caminho.`);
      continue;
    }
    usedOutputs.add(key);
    valid.push(e);
  }

  // ---- alcançabilidade e ciclos (a partir do início) ----
  if (starts.length === 1) {
    const next = new Map<string, string[]>();
    for (const e of valid) next.set(e.source, [...(next.get(e.source) ?? []), e.target]);

    const state = new Map<string, "open" | "done">();
    const path: string[] = [];
    const reportedCycles = new Set<string>();
    const visit = (id: string): void => {
      state.set(id, "open");
      path.push(id);
      for (const t of next.get(id) ?? []) {
        if (state.get(t) === "open") {
          const cycle = path.slice(path.indexOf(t));
          const canExit = cycle.some((cid) => {
            const d = defs.get(cid);
            return d ? isBranching(d) : false;
          });
          if (!canExit && !reportedCycles.has(t)) {
            reportedCycles.add(t);
            const d = defs.get(t);
            issues.push({ severity: "warning", code: "CYCLE_NO_EXIT", message: `${d?.label ?? t}: o fluxo volta para este nó sem nenhuma condição de saída (loop infinito).`, nodeId: t });
          }
        } else if (!state.has(t)) visit(t);
      }
      path.pop();
      state.set(id, "done");
    };
    visit(starts[0]!.id);

    for (const n of doc.nodes) {
      const d = defs.get(n.id);
      if (d && !state.has(n.id)) {
        issues.push({ severity: "warning", code: "UNREACHABLE_NODE", message: `${d.label} (${n.id}) não é alcançado a partir do início.`, nodeId: n.id });
      }
    }
  }

  return issues;
}

export const hasErrors = (issues: Issue[]): boolean => issues.some((i) => i.severity === "error");
