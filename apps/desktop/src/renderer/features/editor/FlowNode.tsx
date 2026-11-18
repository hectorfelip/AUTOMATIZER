import { CATEGORIES } from "@automation-studio/node-registry";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { FlowNodeData } from "./toFlow";

const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

/** Cartão de um nó. Problemas aparecem em texto ("Erro"/"Aviso"), não só em cor. */
export function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { inputs, outputs, errors, warnings } = data;
  const border = selected ? "border-brand ring-2 ring-brand" : errors ? "border-danger" : "border-line";
  const multi = outputs.length > 1;

  return (
    <div className={`min-w-44 max-w-64 rounded-lg border bg-panel text-fg shadow-sm ${border}`}>
      {inputs.map((p) => (
        <Handle key={p.id} type="target" position={Position.Left} id={p.id} title={p.label} />
      ))}
      <div className="flex items-start justify-between gap-2 px-3 py-2">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-wide text-muted">{categoryLabel(data.category)}</div>
          <div className="truncate font-medium">{data.label}</div>
        </div>
        {errors > 0 ? (
          <span className="shrink-0 rounded border border-danger px-1.5 text-xs text-danger" aria-label={`${errors} erro(s)`}>
            Erro
          </span>
        ) : warnings > 0 ? (
          <span className="shrink-0 rounded border border-line px-1.5 text-xs text-muted" aria-label={`${warnings} aviso(s)`}>
            Aviso
          </span>
        ) : null}
      </div>
      {data.summary && <div className="truncate border-t border-line px-3 py-1 text-xs text-muted">{data.summary}</div>}
      {multi ? (
        <div className="border-t border-line">
          {outputs.map((p) => (
            <div key={p.id} className="relative px-3 py-1 text-right text-xs text-muted">
              {p.label}
              <Handle type="source" position={Position.Right} id={p.id} title={p.label} />
            </div>
          ))}
        </div>
      ) : (
        outputs.map((p) => <Handle key={p.id} type="source" position={Position.Right} id={p.id} title={p.label} />)
      )}
    </div>
  );
}
