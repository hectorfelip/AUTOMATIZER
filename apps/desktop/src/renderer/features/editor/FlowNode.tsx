import { CATEGORIES } from "@automation-studio/node-registry";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { useBreakpoints } from "../../stores/breakpoints";
import { useEditor } from "../../stores/editor";
import { useRun, type NodeRow } from "../../stores/run";
import type { FlowNodeData } from "./toFlow";

/** Estado do nó na execução atual, em texto (não só em cor). */
function runBadge(row: NodeRow | undefined, pausedHere: boolean): { text: string; cls: string } | null {
  if (pausedHere) return { text: "Pausado aqui", cls: "border-brand text-brand" };
  if (!row) return null;
  if (row.state === "running") return { text: "Executando", cls: "border-brand text-brand" };
  if (row.state === "completed") return { text: "Concluído", cls: "border-line text-muted" };
  return row.handled ? { text: "Falhou (seguiu)", cls: "border-line text-danger" } : { text: "Falhou", cls: "border-danger text-danger" };
}

const categoryLabel = (id: string) => CATEGORIES.find((c) => c.id === id)?.label ?? id;

/** Cartão de um nó. Problemas aparecem em texto ("Erro"/"Aviso"), não só em cor. */
export function FlowNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { inputs, outputs, errors, warnings } = data;
  const multi = outputs.length > 1;
  const row = useRun((s) => s.rows.find((r) => r.nodeId === id));
  const pausedHere = useRun((s) => s.paused?.nodeId === id);
  const badge = runBadge(row, pausedHere);
  const automationId = useEditor((s) => s.automationId ?? "");
  const hasBreakpoint = useBreakpoints((s) => (s.byAutomation[automationId] ?? []).includes(id));
  const border = selected ? "border-brand ring-2 ring-brand" : badge?.text === "Executando" || pausedHere ? "border-brand ring-2 ring-brand/50" : errors || badge?.text === "Falhou" ? "border-danger" : "border-line";

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
        <button
          type="button"
          className="nodrag nopan mt-0.5 shrink-0 text-base leading-none"
          aria-pressed={hasBreakpoint}
          aria-label={`${hasBreakpoint ? "Remover" : "Adicionar"} breakpoint em ${data.label}`}
          title="Breakpoint: pausar a execução antes deste nó (F9)"
          onClick={(e) => {
            e.stopPropagation();
            useBreakpoints.getState().toggle(automationId, id);
          }}
        >
          <span className={hasBreakpoint ? "text-danger" : "text-line"}>●</span>
        </button>
        {badge ? (
          <span className={`shrink-0 rounded border px-1.5 text-xs ${badge.cls}`} data-testid={`node-state-${id}`}>
            {badge.text}
          </span>
        ) : errors > 0 ? (
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
