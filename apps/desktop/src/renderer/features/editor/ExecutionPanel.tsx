import { Button } from "../../components/ui/Button";
import { currentNodeId, useRun, type NodeRunState, type NodeRow } from "../../stores/run";
import { SnapshotView } from "./SnapshotView";

const finalText = { completed: "Execução concluída", completed_with_warnings: "Execução concluída com avisos", failed: "Execução falhou", cancelled: "Execução cancelada" } as const;
const pauseText = { breakpoint: "breakpoint", step: "passo a passo", user: "pedido de pausa", start: "início do passo a passo" } as const;

function stateText(r: NodeRow): string {
  const t: Record<NodeRunState, string> = { running: "Executando…", completed: "Concluído", failed: "Falhou" };
  return r.state === "failed" && r.handled ? "Falhou — o fluxo seguiu" : t[r.state];
}

export function ExecutionPanel() {
  const run = useRun();
  const { running, rows, finished, startError, workflowName, paused, pauseRequested, snapshot, clear } = run;

  if (!running && !finished && rows.length === 0 && !startError) {
    return <p className="text-sm text-muted">Clique em “Executar” para rodar o fluxo ou em “Passo a passo” para acompanhar nó a nó. Os eventos aparecem aqui em tempo real.</p>;
  }
  const current = currentNodeId(run);
  const currentLabel = rows.find((r) => r.nodeId === current)?.label ?? paused?.label;
  const failedRow = finished?.failedNodeId ? rows.find((r) => r.nodeId === finished.failedNodeId) : undefined;

  return (
    <div className="flex flex-col gap-3" data-testid="execution-panel">
      {startError && (
        <p role="alert" className="rounded-md border border-danger p-2 text-sm text-danger">
          {startError}
        </p>
      )}
      {(running || finished) && (
        <p role="status" data-testid="run-status" className="font-medium">
          {paused
            ? `Pausada antes de “${paused.label}” (${pauseText[paused.reason]})`
            : running
              ? `Executando “${workflowName}”…`
              : `${finalText[finished!.status]} em ${(finished!.durationMs / 1000).toFixed(1)} s`}
        </p>
      )}
      {running && !paused && currentLabel && (
        <p className="text-sm text-muted" data-testid="run-current">
          Nó atual: <span className="font-medium text-fg">{currentLabel}</span>
          {pauseRequested && " — pausa pedida; vale ao fim deste nó"}
        </p>
      )}
      {finished && (finished.warnings ?? 0) > 0 && (
        <p role="status" className="rounded-md border border-line p-2 text-sm" data-testid="run-warnings">
          {finished.warnings} nó(s) falharam e foram ignorados (política “continuar em caso de erro”). Veja os nós marcados abaixo.
        </p>
      )}
      {finished?.error && (
        <div role="alert" className="rounded-md border border-danger p-2 text-sm text-danger" data-testid="run-error">
          {failedRow && (
            <p className="font-medium">
              Nó que falhou: {failedRow.label}
            </p>
          )}
          <p>{finished.error.message}</p>
        </div>
      )}
      <ol className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.nodeId} className={`rounded-md border p-2 text-sm ${r.nodeId === current ? "border-brand" : "border-line"}`} data-testid={`run-row-${r.nodeId}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{r.label}</span>
              <span className={r.state === "failed" ? "text-danger" : "text-muted"}>{stateText(r)}</span>
            </div>
            {r.state === "running" && r.percent !== undefined && <progress className="mt-1 h-1.5 w-full" max={100} value={r.percent} aria-label={`Progresso de ${r.label}`} />}
            {r.message && <p className="mt-0.5 text-xs text-muted">{r.message}</p>}
          </li>
        ))}
      </ol>
      {snapshot && (
        <details open={paused !== null} className="rounded-md border border-line p-2">
          <summary className="cursor-pointer text-sm font-medium">{running ? "Variáveis e resultados agora" : "Variáveis e resultados no fim"}</summary>
          <div className="mt-2">
            <SnapshotView snapshot={snapshot} />
          </div>
        </details>
      )}
      {!running && (
        <Button size="sm" onClick={clear}>
          Limpar
        </Button>
      )}
    </div>
  );
}
