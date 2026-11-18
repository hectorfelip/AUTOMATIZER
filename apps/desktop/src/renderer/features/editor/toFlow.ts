import { getNodeDefinition, type Port } from "@automation-studio/node-registry";
import type { WorkflowDocument } from "@automation-studio/workflow-schema";
import type { Issue } from "@automation-studio/workflow-validator";
import { MarkerType, type Edge, type Node } from "@xyflow/react";

export interface FlowNodeData extends Record<string, unknown> {
  type: string;
  label: string;
  category: string;
  summary: string;
  inputs: Port[];
  outputs: Port[];
  errors: number;
  warnings: number;
  unknown: boolean;
}

/** Primeiro parâmetro preenchido, para o cartão mostrar do que se trata sem abrir o painel. */
function summarize(doc: WorkflowDocument, id: string): string {
  const node = doc.nodes.find((n) => n.id === id)!;
  const def = getNodeDefinition(node.type);
  for (const f of def?.fields ?? []) {
    const v = node.config[f.key];
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number" && f.kind === "number") return `${f.label}: ${v}`;
  }
  return "";
}

/** Documento → nós/arestas do React Flow. O React Flow só *mostra* o que vem daqui; a verdade é o documento. */
export function toFlow(
  doc: WorkflowDocument,
  issues: Issue[],
  selectedNodes: ReadonlySet<string>,
  selectedEdges: ReadonlySet<string>,
  override: Record<string, { x: number; y: number }> = {},
  measured: Record<string, { width: number; height: number }> = {},
): { nodes: Node<FlowNodeData>[]; edges: Edge[] } {
  const nodes = doc.nodes.map((n): Node<FlowNodeData> => {
    const def = getNodeDefinition(n.type);
    const mine = issues.filter((i) => i.nodeId === n.id);
    return {
      id: n.id,
      type: "flowNode",
      position: override[n.id] ?? doc.visual.positions[n.id] ?? { x: 0, y: 0 },
      selected: selectedNodes.has(n.id),
      measured: measured[n.id],
      ariaLabel: def?.label ?? n.type,
      data: {
        type: n.type,
        label: def?.label ?? `Desconhecido: ${n.type}`,
        category: def?.category ?? "control",
        summary: summarize(doc, n.id),
        inputs: def?.inputs ?? [],
        outputs: def?.outputs ?? [],
        errors: mine.filter((i) => i.severity === "error").length,
        warnings: mine.filter((i) => i.severity === "warning").length,
        unknown: !def,
      },
    };
  });
  const edges = doc.edges.map(
    (e): Edge => ({
      id: e.id,
      source: e.source,
      sourceHandle: e.sourceHandle,
      target: e.target,
      targetHandle: e.targetHandle,
      selected: selectedEdges.has(e.id),
      markerEnd: { type: MarkerType.ArrowClosed },
    }),
  );
  return { nodes, edges };
}
