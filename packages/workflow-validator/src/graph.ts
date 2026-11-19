import { getNodeDefinition, type NodeDefinition, type ResultDef } from "@automation-studio/node-registry";
import { VARIABLE_NAME_PATTERN, type WorkflowDocument, type WorkflowNode } from "@automation-studio/workflow-schema";
import { scanTemplate } from "./templates.js";

export interface LoopInfo {
  /** Nome do item no corpo (`{{item}}`). */
  name: string;
  foreachId: string;
  /** Propriedades de cada item, quando a lista vem de um resultado que as declara. */
  itemProps?: string[];
}

export interface Graph {
  nodes: Map<string, WorkflowNode>;
  /** Existe um caminho de `from` até `to` (com pelo menos uma conexão)? */
  reaches(from: string, to: string): boolean;
  /** Laços "Para cada item" em cujo corpo o nó está. */
  loopsAt(nodeId: string): LoopInfo[];
}

const FOREACH = "flow.foreach";

/** Resultado declarado por `{{nodes.<id>.<key>}}`, se existir. */
export function resultOf(nodes: Map<string, WorkflowNode>, nodeId: string, key: string): ResultDef | undefined {
  const n = nodes.get(nodeId);
  return n ? getNodeDefinition(n.type)?.results?.find((r) => r.key === key) : undefined;
}

/** Análise do grafo usada pelo validador e pelo seletor de referências da interface. */
export function buildGraph(doc: WorkflowDocument): Graph {
  const nodes = new Map<string, WorkflowNode>(doc.nodes.map((n) => [n.id, n]));
  const out = new Map<string, { handle: string; target: string }[]>();
  for (const e of doc.edges) {
    if (!nodes.has(e.source) || !nodes.has(e.target)) continue; // conexões quebradas são reportadas à parte
    out.set(e.source, [...(out.get(e.source) ?? []), { handle: e.sourceHandle, target: e.target }]);
  }

  const bfs = (starts: string[], stopAt?: string): Set<string> => {
    const seen = new Set<string>();
    const queue = [...starts];
    while (queue.length) {
      const id = queue.pop()!;
      if (seen.has(id) || id === stopAt) continue;
      seen.add(id);
      for (const e of out.get(id) ?? []) queue.push(e.target);
    }
    return seen;
  };

  const reach = new Map<string, Set<string>>();
  const reaches = (from: string, to: string): boolean => {
    let set = reach.get(from);
    if (!set) reach.set(from, (set = bfs((out.get(from) ?? []).map((e) => e.target))));
    return set.has(to);
  };

  // corpo de cada "Para cada item": o que se alcança a partir de `body`, sem passar de novo pelo próprio nó
  const loops = new Map<string, LoopInfo[]>();
  for (const f of doc.nodes) {
    if (f.type !== FOREACH) continue;
    const raw = f.config["itemName"];
    const name = typeof raw === "string" && raw.trim() ? raw : "item";
    const whole = typeof f.config["items"] === "string" ? scanTemplate(f.config["items"]).whole : null;
    const itemProps = whole?.kind === "nodes" && whole.path.length === 0 ? resultOf(nodes, whole.nodeId, whole.key)?.itemProps : undefined;
    const body = bfs((out.get(f.id) ?? []).filter((e) => e.handle === "body").map((e) => e.target), f.id);
    for (const id of body) loops.set(id, [...(loops.get(id) ?? []), { name, foreachId: f.id, ...(itemProps ? { itemProps } : {}) }]);
  }

  return { nodes, reaches, loopsAt: (id) => loops.get(id) ?? [] };
}

/** Variáveis declaradas + as definidas por nós "Definir variável" (nome fixo). */
export function knownVariables(doc: WorkflowDocument): Set<string> {
  const known = new Set<string>(Object.keys(doc.variables));
  for (const n of doc.nodes) {
    const name = n.type === "data.set_variable" ? n.config["name"] : undefined;
    if (typeof name === "string" && VARIABLE_NAME_PATTERN.test(name)) known.add(name);
  }
  return known;
}

export interface AvailableRefs {
  variables: string[];
  results: { nodeId: string; nodeLabel: string; key: string; label: string; type: ResultDef["type"]; ref: string }[];
  loops: { name: string; refs: string[] }[];
}

/** O que um nó pode referenciar em `{{ }}`: variáveis, resultados de nós anteriores e itens de laços em volta dele. */
export function availableReferences(doc: WorkflowDocument, nodeId: string): AvailableRefs {
  const graph = buildGraph(doc);
  const results: AvailableRefs["results"] = [];
  for (const n of doc.nodes) {
    const def: NodeDefinition | undefined = getNodeDefinition(n.type);
    if (!def?.results?.length || n.id === nodeId || !graph.reaches(n.id, nodeId)) continue;
    for (const r of def.results) results.push({ nodeId: n.id, nodeLabel: def.label, key: r.key, label: r.label, type: r.type, ref: `{{nodes.${n.id}.${r.key}}}` });
  }
  results.sort((a, b) => a.nodeLabel.localeCompare(b.nodeLabel, "pt-BR") || a.key.localeCompare(b.key));
  const loops = graph.loopsAt(nodeId).map((l) => ({ name: l.name, refs: [`{{${l.name}}}`, ...(l.itemProps ?? []).map((p) => `{{${l.name}.${p}}}`)] }));
  return { variables: [...knownVariables(doc)].sort(), results, loops };
}
