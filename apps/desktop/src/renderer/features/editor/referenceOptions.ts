import type { FieldKind } from "@automation-studio/node-registry";
import type { AvailableRefs } from "@automation-studio/workflow-validator";

export interface RefOption {
  label: string;
  /** Texto inserido no campo, ex.: `{{nodes.listar.count}}`. */
  ref: string;
}
export interface RefGroup {
  label: string;
  options: RefOption[];
}

const TYPE_LABEL = { string: "texto", number: "número", boolean: "lógico", list: "lista", object: "objeto" } as const;

/** Campos que só aceitam a referência inteira (um número ou uma lista), sem texto em volta. */
export const replacesValue = (kind: FieldKind): boolean => kind === "list" || kind === "number";

/**
 * Referências que fazem sentido para um campo. Lista só em campo "lista"; listas inteiras e objetos
 * não cabem em texto/número (o validador recusaria), então nem são oferecidos.
 */
export function referenceOptions(refs: AvailableRefs, kind: FieldKind): RefGroup[] {
  const groups: RefGroup[] = [];
  if (kind === "list") {
    const lists = refs.results.filter((r) => r.type === "list").map((r) => ({ label: `${r.nodeLabel} › ${r.label}`, ref: r.ref }));
    return lists.length ? [{ label: "Listas de nós anteriores", options: lists }] : [];
  }
  if (refs.variables.length) groups.push({ label: "Variáveis", options: refs.variables.map((v) => ({ label: v, ref: `{{variables.${v}}}` })) });
  const results = refs.results.filter((r) => r.type !== "list" && r.type !== "object").map((r) => ({ label: `${r.nodeLabel} › ${r.label} (${TYPE_LABEL[r.type]})`, ref: r.ref }));
  if (results.length) groups.push({ label: "Resultados de nós anteriores", options: results });
  for (const loop of refs.loops) {
    // com propriedades conhecidas, oferece cada uma (o item inteiro é um objeto e não cabe em texto);
    // sem elas, o item é um valor simples (texto/número) e se oferece inteiro
    const props = loop.refs.filter((r) => r !== `{{${loop.name}}}`).map((r) => ({ label: r.slice(2, -2), ref: r }));
    groups.push({ label: `Item “${loop.name}” do laço`, options: props.length ? props : [{ label: loop.name, ref: `{{${loop.name}}}` }] });
  }
  return groups;
}

/** Valor do campo depois de escolher uma referência. */
export function insertReference(current: string, ref: string, kind: FieldKind): string {
  if (replacesValue(kind) || current.trim() === "") return ref;
  return current + ref;
}
