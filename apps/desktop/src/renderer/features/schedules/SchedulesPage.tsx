import { useEffect, useState } from "react";
import type { Schedule } from "@automation-studio/shared-types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { errorMessage } from "../../lib/api";
import { describeConfig, describeLastStatus, taskStateLabel } from "../../lib/schedule";
import { formatWhen } from "../../lib/status";
import { useAutomations } from "../../stores/automations";
import { useSchedules } from "../../stores/schedules";
import { ScheduleDialog } from "./ScheduleDialog";

type Dlg = { kind: "new" } | { kind: "edit"; item: Schedule } | { kind: "delete"; item: Schedule } | null;

export function SchedulesPage() {
  const { items, loaded, loadError, load, create, update, setEnabled, resync, remove } = useSchedules();
  const automations = useAutomations((s) => s.items).filter((a) => a.status === "active");
  const [dialog, setDialog] = useState<Dlg>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const close = () => setDialog(null);
  const unsupported = items.some((s) => s.taskState === "unsupported");

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agendamentos</h1>
        <Button variant="primary" disabled={automations.length === 0} title={automations.length === 0 ? "Crie uma automação primeiro" : undefined} onClick={() => setDialog({ kind: "new" })}>
          Novo agendamento
        </Button>
      </header>
      <p className="text-sm text-muted">Quem dispara é o Agendador de Tarefas do Windows, na sua sessão. Ações de mouse e teclado exigem sessão desbloqueada.</p>
      {unsupported && (
        <p role="note" className="rounded-md border border-line p-3 text-sm" data-testid="schedule-unsupported">
          Os agendamentos ficam salvos, mas só são registrados no Agendador do Windows com o aplicativo instalado; aqui eles não serão disparados.
        </p>
      )}
      {(loadError || error) && (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
          {loadError ?? error}
        </p>
      )}
      {loaded && !loadError && items.length === 0 && <p className="rounded-md border border-dashed border-line p-8 text-center text-muted">Nenhum agendamento.</p>}
      <ul className="flex flex-col gap-2" data-testid="schedule-list">
        {items.map((s) => {
          const st = taskStateLabel(s);
          return (
            <li key={s.id} className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4" data-testid={`schedule-${s.id}`}>
              <div className="flex items-center gap-2">
                <span className="font-medium">{s.automationName}</span>
                <Badge tone={s.enabled ? "ok" : "muted"}>{s.enabled ? "Ativo" : "Desativado"}</Badge>
                <Badge tone={st.tone}>{st.text}</Badge>
              </div>
              <p className="text-sm">{describeConfig(s.config)}</p>
              <p className="text-xs text-muted">
                Próxima: {s.nextRunAt ? formatWhen(s.nextRunAt) : "—"} · Última: {s.lastRunAt ? `${formatWhen(s.lastRunAt)} (${describeLastStatus(s.lastStatus)})` : "nunca"}
              </p>
              {s.taskError && <p className="text-xs text-muted">{s.taskError}</p>}
              <div className="flex gap-2">
                <Button size="sm" aria-label={`${s.enabled ? "Desativar" : "Ativar"} agendamento de ${s.automationName}`} onClick={() => void run(() => setEnabled(s.id, !s.enabled))}>
                  {s.enabled ? "Desativar" : "Ativar"}
                </Button>
                <Button size="sm" aria-label={`Editar agendamento de ${s.automationName}`} onClick={() => setDialog({ kind: "edit", item: s })}>
                  Editar
                </Button>
                {s.taskState === "error" && (
                  <Button size="sm" onClick={() => void run(() => resync(s.id))}>
                    Tentar registrar de novo
                  </Button>
                )}
                <Button size="sm" variant="danger" aria-label={`Excluir agendamento de ${s.automationName}`} onClick={() => setDialog({ kind: "delete", item: s })}>
                  Excluir
                </Button>
              </div>
            </li>
          );
        })}
      </ul>

      <ScheduleDialog
        key={dialog?.kind === "edit" ? dialog.item.id : dialog?.kind ?? "closed"}
        open={dialog?.kind === "new" || dialog?.kind === "edit"}
        automations={automations}
        editing={dialog?.kind === "edit" ? dialog.item : null}
        onClose={close}
        onSubmit={(automationId, config) => (dialog?.kind === "edit" ? update(dialog.item.id, config) : create(automationId, config))}
      />
      <Dialog open={dialog?.kind === "delete"} title="Excluir agendamento" onClose={close}>
        <p>
          Excluir o agendamento de <strong>{dialog?.kind === "delete" ? dialog.item.automationName : ""}</strong>? A automação não é afetada.
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={close}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={() => {
              const target = dialog?.kind === "delete" ? dialog.item : null;
              close();
              if (target) void run(() => remove(target.id));
            }}
          >
            Excluir
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
