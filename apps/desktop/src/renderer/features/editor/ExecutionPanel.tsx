import { Button } from "../../components/ui/Button";
import { useRun, type NodeRunState } from "../../stores/run";

const stateText: Record<NodeRunState, string> = { running: "Executando…", completed: "Concluído", failed: "Falhou" };
const finalText = { completed: "Execução concluída", failed: "Execução falhou", cancelled: "Execução cancelada" } as const;

export function ExecutionPanel() {
  const { running, rows, finished, startError, workflowName, clear } = useRun();

  if (!running && !finished && rows.length === 0 && !startError) {
    return <p className="text-sm text-muted">Clique em “Executar” para rodar o fluxo. Os eventos aparecem aqui em tempo real.</p>;
  }
  return (
    <div className="flex flex-col gap-3" data-testid="execution-panel">
      {startError && (
        <p role="alert" className="rounded-md border border-danger p-2 text-sm text-danger">
          {startError}
        </p>
      )}
      {(running || finished) && (
        <p role="status" data-testid="run-status" className="font-medium">
          {running ? `Executando “${workflowName}”…` : `${finalText[finished!.status]} em ${(finished!.durationMs / 1000).toFixed(1)} s`}
        </p>
      )}
      {finished?.error && (
        <p role="alert" className="rounded-md border border-danger p-2 text-sm text-danger">
          {finished.error.message}
        </p>
      )}
      <ol className="flex flex-col gap-2">
        {rows.map((r) => (
          <li key={r.nodeId} className="rounded-md border border-line p-2 text-sm" data-testid={`run-row-${r.nodeId}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-medium">{r.label}</span>
              <span className={r.state === "failed" ? "text-danger" : "text-muted"}>{stateText[r.state]}</span>
            </div>
            {r.state === "running" && r.percent !== undefined && (
              <progress className="mt-1 h-1.5 w-full" max={100} value={r.percent} aria-label={`Progresso de ${r.label}`} />
            )}
            {r.message && <p className="mt-0.5 text-xs text-muted">{r.message}</p>}
          </li>
        ))}
      </ol>
      {!running && (
        <Button size="sm" onClick={clear}>
          Limpar
        </Button>
      )}
    </div>
  );
}
