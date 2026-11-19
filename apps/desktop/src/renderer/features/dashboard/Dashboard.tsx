import type { ReactNode } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { useEffect } from "react";
import { formatDuration, formatWhen, STATUS_LABEL, STATUS_TONE } from "../../lib/status";
import { useHistory } from "../../stores/history";
import { useAutomations } from "../../stores/automations";
import { describeEngine, useEngine } from "../../stores/engine";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="rounded-lg border border-line bg-panel p-5">
      <h2 className="text-sm font-medium text-muted">{title}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

export function Dashboard({ onCreate }: { onCreate: () => void }) {
  const items = useAutomations((s) => s.items);
  const active = items.filter((a) => a.status === "active").length;
  const { items: recent, stats } = useHistory();
  useEffect(() => {
    void useHistory.getState().setFilter({ automationId: "", status: "all", period: "all" });
  }, []);
  const engine = describeEngine(useEngine((s) => s.status));

  return (
    <section className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <Button variant="primary" onClick={onCreate}>
          Nova automação
        </Button>
      </header>
      <div className="grid grid-cols-3 gap-4">
        <Card title="Automações ativas">
          <p className="text-3xl font-semibold" data-testid="active-count">
            {active}
          </p>
        </Card>
        <Card title="Arquivadas">
          <p className="text-3xl font-semibold">{items.length - active}</p>
        </Card>
        <Card title="Motor de automação">
          <div data-testid="engine-status">
            <Badge tone={engine.ready ? "ok" : engine.label === "Indisponível" ? "danger" : "muted"}>{engine.label}</Badge>
            <p className="mt-2 text-sm text-muted">{engine.detail}</p>
          </div>
        </Card>
      </div>
      <Card title="Execuções recentes">
        {recent.length === 0 ? (
          <p className="text-muted">Nenhuma execução registrada.</p>
        ) : (
          <>
            <p className="mb-2 text-sm text-muted" data-testid="dashboard-stats">
              {stats?.completed ?? 0} concluídas · {stats?.completedWithWarnings ?? 0} com avisos · {stats?.failed ?? 0} falhas · {stats?.cancelled ?? 0} canceladas
            </p>
            <ul className="flex flex-col gap-1" data-testid="recent-executions">
              {recent.slice(0, 5).map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{e.workflowName}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-muted">{formatWhen(e.startedAt)} · {formatDuration(e.durationMs)}</span>
                    <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>
    </section>
  );
}
