import { defaultConfig, getNodeDefinition } from "@automation-studio/node-registry";
import {
  VARIABLE_NAME_PATTERN,
  type ConfigValue,
  type VariableType,
  type WorkflowDocument,
  type WorkflowEdge,
  type WorkflowVariable,
} from "@automation-studio/workflow-schema";

/**
 * Operações puras sobre o documento: nunca mutam e devolvem a MESMA referência quando nada muda
 * (o histórico usa isso para ignorar não-mudanças).
 */

const short = (): string => crypto.randomUUID().slice(0, 8);
export const newNodeId = (type: string): string => `${type.split(".")[1]!.replace(/_/g, "-")}-${short()}`;
export const edgeId = (c: { source: string; sourceHandle: string; target: string; targetHandle: string }): string =>
  `e:${c.source}.${c.sourceHandle}>${c.target}.${c.targetHandle}`;

export function addNode(doc: WorkflowDocument, type: string, position: { x: number; y: number }, id = newNodeId(type)): WorkflowDocument {
  const def = getNodeDefinition(type);
  if (!def) return doc;
  if (def.unique && doc.nodes.some((n) => n.type === type)) return doc;
  return {
    ...doc,
    nodes: [...doc.nodes, { id, type, version: def.version, config: defaultConfig(def) }],
    visual: { positions: { ...doc.visual.positions, [id]: { x: Math.round(position.x), y: Math.round(position.y) } } },
  };
}

export function removeNodes(doc: WorkflowDocument, ids: string[]): WorkflowDocument {
  const gone = new Set(ids);
  if (!doc.nodes.some((n) => gone.has(n.id))) return doc;
  return {
    ...doc,
    nodes: doc.nodes.filter((n) => !gone.has(n.id)),
    edges: doc.edges.filter((e) => !gone.has(e.source) && !gone.has(e.target)),
    visual: { positions: Object.fromEntries(Object.entries(doc.visual.positions).filter(([id]) => !gone.has(id))) },
  };
}

export function removeEdges(doc: WorkflowDocument, ids: string[]): WorkflowDocument {
  const gone = new Set(ids);
  if (!doc.edges.some((e) => gone.has(e.id))) return doc;
  return { ...doc, edges: doc.edges.filter((e) => !gone.has(e.id)) };
}

export function moveNodes(doc: WorkflowDocument, moves: Record<string, { x: number; y: number }>): WorkflowDocument {
  let changed = false;
  const positions = { ...doc.visual.positions };
  for (const [id, p] of Object.entries(moves)) {
    const x = Math.round(p.x);
    const y = Math.round(p.y);
    const cur = positions[id];
    if (cur?.x !== x || cur?.y !== y) {
      positions[id] = { x, y };
      changed = true;
    }
  }
  return changed ? { ...doc, visual: { positions } } : doc;
}

/** Por que uma conexão não pode ser criada (null = pode). Mesmas regras do validador, aplicadas na hora do arrastar. */
export function connectionProblem(doc: WorkflowDocument, c: { source: string; sourceHandle: string; target: string; targetHandle: string }): string | null {
  const from = doc.nodes.find((n) => n.id === c.source);
  const to = doc.nodes.find((n) => n.id === c.target);
  const fromDef = from && getNodeDefinition(from.type);
  const toDef = to && getNodeDefinition(to.type);
  if (!fromDef || !toDef) return "Nó inexistente.";
  if (c.source === c.target) return "Um nó não pode ser ligado a si mesmo.";
  if (!fromDef.outputs.some((p) => p.id === c.sourceHandle)) return "Saída inexistente.";
  if (!toDef.inputs.some((p) => p.id === c.targetHandle)) return "Entrada inexistente.";
  if (doc.edges.some((e) => e.source === c.source && e.sourceHandle === c.sourceHandle)) return "Esta saída já está conectada.";
  return null;
}

export function connect(doc: WorkflowDocument, c: { source: string; sourceHandle: string; target: string; targetHandle: string }): WorkflowDocument {
  if (connectionProblem(doc, c)) return doc;
  const edge: WorkflowEdge = { id: edgeId(c), ...c };
  return { ...doc, edges: [...doc.edges, edge] };
}

export function updateNodeConfig(doc: WorkflowDocument, nodeId: string, key: string, value: ConfigValue): WorkflowDocument {
  const node = doc.nodes.find((n) => n.id === nodeId);
  if (!node || node.config[key] === value) return doc;
  return { ...doc, nodes: doc.nodes.map((n) => (n.id === nodeId ? { ...n, config: { ...n.config, [key]: value } } : n)) };
}

/** Duplica nós (e as conexões entre eles). Tipos únicos (início) não são duplicados. */
export function duplicateNodes(doc: WorkflowDocument, ids: string[]): { doc: WorkflowDocument; newIds: string[] } {
  const idMap = new Map<string, string>();
  const nodes = [...doc.nodes];
  const positions = { ...doc.visual.positions };
  for (const n of doc.nodes) {
    if (!ids.includes(n.id) || getNodeDefinition(n.type)?.unique) continue;
    const id = newNodeId(n.type);
    idMap.set(n.id, id);
    nodes.push({ ...n, id, config: { ...n.config } });
    const p = doc.visual.positions[n.id] ?? { x: 0, y: 0 };
    positions[id] = { x: p.x + 40, y: p.y + 40 };
  }
  if (idMap.size === 0) return { doc, newIds: [] };
  const edges = [...doc.edges];
  for (const e of doc.edges) {
    const s = idMap.get(e.source);
    const t = idMap.get(e.target);
    if (s && t) edges.push({ ...e, id: edgeId({ ...e, source: s, target: t }), source: s, target: t });
  }
  return { doc: { ...doc, nodes, edges, visual: { positions } }, newIds: [...idMap.values()] };
}

// ---- variáveis ----
export function addVariable(doc: WorkflowDocument): WorkflowDocument {
  let i = Object.keys(doc.variables).length + 1;
  while (`variavel${i}` in doc.variables) i++;
  return { ...doc, variables: { ...doc.variables, [`variavel${i}`]: { type: "string", value: "" } } };
}

export function removeVariable(doc: WorkflowDocument, name: string): WorkflowDocument {
  if (!(name in doc.variables)) return doc;
  return { ...doc, variables: Object.fromEntries(Object.entries(doc.variables).filter(([k]) => k !== name)) };
}

/** Renomeia mantendo a ordem. Erro (texto) se o nome for inválido ou já existir. */
export function renameVariable(doc: WorkflowDocument, from: string, to: string): WorkflowDocument | string {
  if (from === to) return doc;
  if (!VARIABLE_NAME_PATTERN.test(to)) return "Use letras, números e _, começando por letra ou _ (máx. 64).";
  if (to in doc.variables) return "Já existe uma variável com esse nome.";
  return { ...doc, variables: Object.fromEntries(Object.entries(doc.variables).map(([k, v]) => [k === from ? to : k, v])) };
}

export function setVariable(doc: WorkflowDocument, name: string, v: WorkflowVariable): WorkflowDocument {
  const cur = doc.variables[name];
  if (!cur || (cur.type === v.type && cur.value === v.value)) return doc;
  return { ...doc, variables: { ...doc.variables, [name]: v } };
}

/** Converte o valor ao trocar o tipo da variável. */
export function convertVariableValue(value: WorkflowVariable["value"], to: VariableType): WorkflowVariable["value"] {
  if (to === "string") return String(value);
  if (to === "boolean") return value === true || value === "true";
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
