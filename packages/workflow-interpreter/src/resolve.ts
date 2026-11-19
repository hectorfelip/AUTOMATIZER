import { getNodeDefinition, type FieldKind } from "@automation-studio/node-registry";
import type { ConfigValue, WorkflowDocument } from "@automation-studio/workflow-schema";
import { hasTemplate, scanTemplate, type Ref } from "@automation-studio/workflow-validator";

export type Scalar = string | number | boolean;
export type Variables = Record<string, Scalar>;
export type ResolveResult = { ok: true; config: Record<string, ConfigValue> } | { ok: false; message: string };

/** Item corrente de um "Para cada item" ativo (o mais novo da pilha é o mais interno). */
export interface LoopScope {
  nodeId: string;
  name: string;
  item: unknown;
  index: number;
  count: number;
}

/** O que `{{ }}` pode enxergar durante UMA execução. Nada é compartilhado entre execuções. */
export interface ResolveContext {
  variables: Variables;
  /** Último resultado de cada nó já executado (`{{nodes.<id>.<resultado>}}`). */
  nodes: Map<string, Record<string, unknown>>;
  /** Nome legível de cada nó, para mensagens de erro. */
  labels: Map<string, string>;
  loops: LoopScope[];
}

export const initialVariables = (doc: WorkflowDocument): Variables =>
  Object.fromEntries(Object.entries(doc.variables).map(([k, v]) => [k, v.value]));

export const createContext = (doc: WorkflowDocument): ResolveContext => ({
  variables: initialVariables(doc),
  nodes: new Map(),
  labels: new Map(doc.nodes.map((n) => [n.id, getNodeDefinition(n.type)?.label ?? n.type])),
  loops: [],
});

type Lookup = { ok: true; value: unknown } | { ok: false; message: string };
const INDEX = /^\d+$/;

/** Caminha por `a.b.0.c`. Só propriedades PRÓPRIAS e posições de listas: nunca protótipo, `length` ou métodos. */
function traverse(start: unknown, path: string[], raw: string): Lookup {
  let cur = start;
  for (const seg of path) {
    if (Array.isArray(cur)) {
      if (!INDEX.test(seg) || Number(seg) >= cur.length) return { ok: false, message: `{{${raw}}}: não há a posição “${seg}” na lista (ela tem ${cur.length} item(ns)).` };
      cur = cur[Number(seg)];
    } else if (cur !== null && typeof cur === "object" && Object.hasOwn(cur, seg)) {
      cur = (cur as Record<string, unknown>)[seg];
    } else {
      return { ok: false, message: `{{${raw}}}: “${seg}” não existe.` };
    }
  }
  return { ok: true, value: cur };
}

function lookup(ref: Ref, ctx: ResolveContext): Lookup {
  if (ref.kind === "variables") {
    return ref.name in ctx.variables ? { ok: true, value: ctx.variables[ref.name] } : { ok: false, message: `A variável “${ref.name}” não está definida.` };
  }
  if (ref.kind === "nodes") {
    const label = ctx.labels.get(ref.nodeId) ?? ref.nodeId;
    const outputs = ctx.nodes.get(ref.nodeId);
    if (!outputs) return { ok: false, message: `O nó “${label}” ainda não foi executado, então {{${ref.raw}}} não tem valor.` };
    if (!Object.hasOwn(outputs, ref.key)) return { ok: false, message: `O nó “${label}” não devolveu “${ref.key}”.` };
    return traverse(outputs[ref.key], ref.path, ref.raw);
  }
  for (let i = ctx.loops.length - 1; i >= 0; i--) {
    const scope = ctx.loops[i]!;
    if (scope.name === ref.name) return traverse(scope.item, ref.path, ref.raw);
  }
  return { ok: false, message: `“${ref.name}” só existe dentro do corpo de um “Para cada item”.` };
}

/** Valor que cabe numa config: texto, número ou lógico. Listas e objetos explicam o que fazer. */
function toScalar(value: unknown, raw: string): { ok: true; value: Scalar | null } | { ok: false; message: string } {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return { ok: true, value };
  if (value === null || value === undefined) return { ok: true, value: null };
  if (Array.isArray(value)) return { ok: false, message: `{{${raw}}} é uma lista; percorra-a com “Para cada item” ou use uma posição (ex.: {{${raw}.0}}).` };
  return { ok: false, message: `{{${raw}}} é um objeto com várias propriedades; use uma delas (ex.: {{${raw}.name}}).` };
}

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Ajusta o valor resolvido ao tipo do campo de destino (texto sempre texto; número aceita "5"). */
function coerce(value: ConfigValue, kind: FieldKind | undefined): ConfigValue {
  if (kind === "text" || kind === "path") return value === null ? value : String(value);
  if (kind === "number" && typeof value === "string" && NUMERIC.test(value.trim())) return Number(value);
  if (kind === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

const ANY = /\{\{[^{}]*\}\}/g;

/**
 * Resolve `{{ }}` na config de um nó. Só lê valores: nada é avaliado.
 * Uma referência "pura" preserva o tipo e o resultado é ajustado ao tipo do campo (`kinds`).
 */
export function resolveConfig(config: Record<string, ConfigValue>, ctx: ResolveContext, kinds: Record<string, FieldKind> = {}): ResolveResult {
  const out: Record<string, ConfigValue> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string" || !hasTemplate(value)) {
      out[key] = value;
      continue;
    }
    const scan = scanTemplate(value);
    if (scan.errors.length) return { ok: false, message: `“${key}”: ${scan.errors[0]}` };
    const values: (Scalar | null)[] = [];
    for (const ref of scan.refs) {
      const found = lookup(ref, ctx);
      if (!found.ok) return { ok: false, message: `“${key}”: ${found.message}` };
      const scalar = toScalar(found.value, ref.raw);
      if (!scalar.ok) return { ok: false, message: `“${key}”: ${scalar.message}` };
      values.push(scalar.value);
    }
    let i = 0;
    out[key] = coerce(scan.whole ? (values[0] ?? null) : value.replace(ANY, () => String(values[i++] ?? "")), kinds[key]);
  }
  return { ok: true, config: out };
}

/** A lista de um "Para cada item": o campo é *só* uma referência a uma lista. */
export function resolveItems(raw: ConfigValue | undefined, ctx: ResolveContext): { ok: true; items: unknown[] } | { ok: false; message: string } {
  const scan = typeof raw === "string" ? scanTemplate(raw) : null;
  if (!scan?.whole) return { ok: false, message: "“Lista” deve ser a referência a uma lista, ex.: {{nodes.listar.files}}." };
  const found = lookup(scan.whole, ctx);
  if (!found.ok) return { ok: false, message: `“Lista”: ${found.message}` };
  if (!Array.isArray(found.value)) return { ok: false, message: `“Lista”: {{${scan.whole.raw}}} não é uma lista.` };
  return { ok: true, items: found.value };
}
