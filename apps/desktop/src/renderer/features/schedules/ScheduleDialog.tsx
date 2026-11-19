import { useState } from "react";
import type { Automation, Schedule, ScheduleConfig, ScheduleKind } from "@automation-studio/shared-types";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { errorMessage } from "../../lib/api";
import { WEEKDAYS } from "../../lib/schedule";

interface Props {
  open: boolean;
  automations: Automation[];
  /** Presente = editando (a automação não muda). */
  editing: Schedule | null;
  onClose: () => void;
  onSubmit: (automationId: string, config: ScheduleConfig) => Promise<void>;
}

const field = "rounded-md border border-line bg-bg px-2 py-1 text-fg";
const pad = (n: number) => String(n).padStart(2, "0");
const defaultOnce = () => {
  const d = new Date(Date.now() + 3_600_000);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function ScheduleDialog({ open, automations, editing, onClose, onSubmit }: Props) {
  const cfg = editing?.config;
  const [automationId, setAutomationId] = useState(editing?.automationId ?? automations[0]?.id ?? "");
  const [kind, setKind] = useState<ScheduleKind>(cfg?.kind ?? "daily");
  const [time, setTime] = useState(cfg && "time" in cfg ? cfg.time : "09:00");
  const [at, setAt] = useState(cfg?.kind === "once" ? cfg.at : defaultOnce());
  const [days, setDays] = useState<number[]>(cfg?.kind === "weekly" ? cfg.days : [1, 2, 3, 4, 5]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const build = (): ScheduleConfig =>
    kind === "once" ? { kind, at } : kind === "daily" ? { kind, time } : kind === "weekly" ? { kind, time, days } : { kind };

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(automationId, build());
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={editing ? "Editar agendamento" : "Novo agendamento"} onClose={onClose}>
      <label className="flex flex-col gap-1 text-sm">
        Automação
        <select className={field} value={automationId} disabled={editing !== null} onChange={(e) => setAutomationId(e.target.value)}>
          {automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Quando
        <select className={field} value={kind} onChange={(e) => setKind(e.target.value as ScheduleKind)}>
          <option value="once">Uma vez</option>
          <option value="daily">Todos os dias</option>
          <option value="weekly">Dias da semana</option>
          <option value="logon">Ao entrar no Windows</option>
        </select>
      </label>
      {kind === "once" && (
        <label className="flex flex-col gap-1 text-sm">
          Data e hora
          <input type="datetime-local" className={field} value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
      )}
      {(kind === "daily" || kind === "weekly") && (
        <label className="flex flex-col gap-1 text-sm">
          Hora
          <input type="time" className={field} value={time} onChange={(e) => setTime(e.target.value)} />
        </label>
      )}
      {kind === "weekly" && (
        <fieldset className="flex flex-wrap gap-3 text-sm">
          <legend className="mb-1">Dias</legend>
          {WEEKDAYS.map((name, i) => (
            <label key={name} className="flex items-center gap-1">
              <input type="checkbox" checked={days.includes(i)} onChange={(e) => setDays(e.target.checked ? [...days, i] : days.filter((d) => d !== i))} />
              {name}
            </label>
          ))}
        </fieldset>
      )}
      <p className="text-sm text-muted">
        Roda a <strong>versão salva</strong> do fluxo, na sua sessão do Windows (precisa estar conectado e com a tela desbloqueada para ações de mouse e teclado). Se o computador estiver desligado na hora, roda assim que ligar.
      </p>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={busy || automationId === ""} onClick={() => void submit()}>
          {editing ? "Salvar" : "Agendar"}
        </Button>
      </div>
    </Dialog>
  );
}
