import type { ContextSnapshot, Preview } from "@automation-studio/shared-types";
import type { ResolveContext } from "./resolve.js";

const MAX_STRING = 200;
const MAX_ITEMS = 5;
const MAX_FIELDS = 20;
const MAX_DEPTH = 3;
const MAX_RESULTS = 200;

/** Resumo seguro e limitado de um valor qualquer (para mostrar na interface sem enviar listas de 2000 itens). */
export function previewValue(value: unknown, depth = 0): Preview {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? { type: "list", count: value.length, items: [] } : { type: "object", fields: {} };
  if (Array.isArray(value)) return { type: "list", count: value.length, items: value.slice(0, MAX_ITEMS).map((v) => previewValue(v, depth + 1)) };
  if (typeof value === "object") {
    const fields: Record<string, Preview> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, MAX_FIELDS)) fields[k] = previewValue(v, depth + 1);
    return { type: "object", fields };
  }
  return String(value);
}

export function buildSnapshot(ctx: ResolveContext): ContextSnapshot {
  return {
    variables: { ...ctx.variables },
    results: [...ctx.nodes].slice(0, MAX_RESULTS).map(([nodeId, outputs]) => ({
      nodeId,
      label: ctx.labels.get(nodeId) ?? nodeId,
      outputs: Object.fromEntries(Object.entries(outputs).map(([k, v]) => [k, previewValue(v)])),
    })),
    loops: ctx.loops.map((l) => ({ name: l.name, index: l.index, count: l.count, item: previewValue(l.item) })),
  };
}
