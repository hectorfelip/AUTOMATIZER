import type { ReactNode } from "react";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
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
        <p className="text-muted">Nenhuma execução registrada.</p>
      </Card>
    </section>
  );
}
