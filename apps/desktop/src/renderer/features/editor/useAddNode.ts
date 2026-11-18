import { useReactFlow } from "@xyflow/react";
import { useCallback } from "react";
import { useEditor } from "../../stores/editor";
import { addNode } from "./docOps";

/** Adiciona um nó no centro visível do canvas (alternativa por clique/teclado ao arrastar). */
export function useAddNode() {
  const { screenToFlowPosition } = useReactFlow();
  return useCallback(
    (type: string) => {
      const s = useEditor.getState();
      const doc = s.history.present;
      const el = document.querySelector(".react-flow");
      const r = el?.getBoundingClientRect();
      const n = doc.nodes.length % 6; // escalona para não empilhar nós adicionados em sequência
      const pos = screenToFlowPosition({ x: (r ? r.left + r.width / 2 : 400) + n * 24 - 80, y: (r ? r.top + r.height / 2 : 300) + n * 24 - 30 });
      const next = addNode(doc, type, pos);
      if (next === doc) return;
      s.commit(next);
      s.select([next.nodes[next.nodes.length - 1]!.id]);
    },
    [screenToFlowPosition],
  );
}
