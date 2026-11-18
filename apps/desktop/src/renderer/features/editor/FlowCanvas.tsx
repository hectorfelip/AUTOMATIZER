import {
  Background,
  Controls,
  ReactFlow,
  useReactFlow,
  type Connection,
  type Node,
  type OnDelete,
  type OnEdgesChange,
  type OnNodeDrag,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useCallback, useMemo, useState, type DragEvent } from "react";
import { currentDoc, issuesOf, useEditor } from "../../stores/editor";
import { addNode, connect, connectionProblem, moveNodes, removeEdges, removeNodes } from "./docOps";
import { FlowNode } from "./FlowNode";
import { DND_MIME } from "./NodePalette";
import { toFlow, type FlowNodeData } from "./toFlow";

const nodeTypes = { flowNode: FlowNode };
type Pos = { x: number; y: number };
type ConnectionLike = { source: string; target: string; sourceHandle?: string | null; targetHandle?: string | null };
const asConn = (c: ConnectionLike) => ({ source: c.source, sourceHandle: c.sourceHandle ?? "", target: c.target, targetHandle: c.targetHandle ?? "" });
type Dim = { width: number; height: number };

/**
 * Canvas controlado: o documento (store) é a fonte da verdade e o React Flow só o exibe.
 * Posição durante o arraste fica em estado local e só vira uma mudança (um passo de desfazer) ao soltar.
 */
export function FlowCanvas() {
  const doc = useEditor(currentDoc)!;
  const selNodes = useEditor((s) => s.selectedNodes);
  const selEdges = useEditor((s) => s.selectedEdges);
  const select = useEditor.getState().select;
  const { screenToFlowPosition } = useReactFlow();
  const [dragPos, setDragPos] = useState<Record<string, Pos>>({});
  const [dims, setDims] = useState<Record<string, Dim>>({});

  const { nodes, edges } = useMemo(
    () => toFlow(doc, issuesOf(doc), new Set(selNodes), new Set(selEdges), dragPos, dims),
    [doc, selNodes, selEdges, dragPos, dims],
  );

  const onNodesChange: OnNodesChange<Node<FlowNodeData>> = useCallback(
    (changeset) => {
      const changes = changeset.toArray();
      const s = useEditor.getState();
      let sel = s.selectedNodes;
      let selChanged = false;
      for (const c of changes) {
        if (c.type === "dimensions" && c.dimensions) {
          const d = c.dimensions;
          setDims((prev) => (prev[c.id]?.width === d.width && prev[c.id]?.height === d.height ? prev : { ...prev, [c.id]: d }));
        } else if (c.type === "position" && c.position) {
          const p = c.position;
          if (c.dragging) setDragPos((prev) => ({ ...prev, [c.id]: p }));
          else s.commit(moveNodes(s.history.present, { [c.id]: p }), `move:${c.id}`); // ajuste por teclado
        } else if (c.type === "select") {
          sel = c.selected ? [...new Set([...sel, c.id])] : sel.filter((id) => id !== c.id);
          selChanged = true;
        }
        // 'remove' é tratado em onDelete (um único passo de desfazer para nós + conexões)
      }
      if (selChanged) s.select(sel, s.selectedEdges);
    },
    [],
  );

  const onEdgesChange: OnEdgesChange = useCallback((changeset) => {
    const s = useEditor.getState();
    let sel = s.selectedEdges;
    let selChanged = false;
    for (const c of changeset.toArray()) {
      if (c.type === "select") {
        sel = c.selected ? [...new Set([...sel, c.id])] : sel.filter((id) => id !== c.id);
        selChanged = true;
      }
    }
    if (selChanged) s.select(s.selectedNodes, sel);
  }, []);

  const onNodeDragStop: OnNodeDrag<Node<FlowNodeData>> = useCallback((_e, _n, dragged) => {
    const s = useEditor.getState();
    s.commit(moveNodes(s.history.present, Object.fromEntries(dragged.map((n) => [n.id, n.position]))));
    setDragPos({});
  }, []);

  const onDelete: OnDelete<Node<FlowNodeData>> = useCallback(({ nodes: ns, edges: es }) => {
    const s = useEditor.getState();
    s.commit(removeEdges(removeNodes(s.history.present, ns.map((n) => n.id)), es.map((e) => e.id)));
    s.select([], []);
  }, []);

  const onConnect = useCallback((c: Connection) => {
    const s = useEditor.getState();
    s.commit(connect(s.history.present, asConn(c)));
  }, []);
  const isValidConnection = useCallback((c: ConnectionLike) => !connectionProblem(useEditor.getState().history.present, asConn(c)), []);

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const type = e.dataTransfer.getData(DND_MIME);
    if (!type) return;
    const s = useEditor.getState();
    const next = addNode(s.history.present, type, screenToFlowPosition({ x: e.clientX, y: e.clientY }));
    if (next === s.history.present) return;
    s.commit(next);
    s.select([next.nodes[next.nodes.length - 1]!.id]);
  };

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeDragStop={onNodeDragStop}
      onDelete={onDelete}
      onConnect={onConnect}
      isValidConnection={isValidConnection}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onPaneClick={() => select([], [])}
      deleteKeyCode={["Delete", "Backspace"]}
      selectionKeyCode="Shift"
      multiSelectionKeyCode={["Control", "Meta"]}
      fitView
      fitViewOptions={{ maxZoom: 1, padding: "6%" }}
      minZoom={0.2}
      maxZoom={2}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
