import { useEffect, useState, type FormEvent } from "react";
import type { TemplateInfo } from "@automation-studio/shared-types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { errorMessage, unwrap } from "../../lib/api";
import { useAutomations } from "../../stores/automations";

interface Props {
  open: boolean;
  onClose: () => void;
  /** Chamado com o id da automação criada (a página abre o editor). */
  onCreated: (automationId: string) => void;
}

export function TemplateDialog({ open, onClose, onCreated }: Props) {
  const [list, setList] = useState<TemplateInfo[]>([]);
  const [selected, setSelected] = useState<string>("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setName("");
    unwrap((a) => a.templates.list()).then(
      (items) => {
        setList(items);
        setSelected((cur) => cur || items[0]?.id || "");
      },
      (e) => setError(errorMessage(e)),
    );
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const created = await useAutomations.getState().createFromTemplate(selected, name.trim() || undefined);
      onClose();
      onCreated(created.id);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title="Novo a partir de exemplo" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset className="flex max-h-72 flex-col gap-2 overflow-auto">
          <legend className="sr-only">Exemplos</legend>
          {list.map((t) => (
            <label key={t.id} className={`flex cursor-pointer gap-3 rounded-md border p-3 ${selected === t.id ? "border-brand" : "border-line"}`}>
              <input type="radio" name="template" value={t.id} checked={selected === t.id} onChange={() => setSelected(t.id)} className="mt-1" />
              <span className="min-w-0">
                <span className="flex items-center gap-2 font-medium">
                  {t.name}
                  {t.windowsOnly && <Badge>Somente Windows</Badge>}
                </span>
                <span className="block text-sm text-muted">{t.description}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <Field label="Nome (opcional)" value={name} onChange={(e) => setName(e.target.value)} placeholder="Usa o nome do exemplo" maxLength={100} />
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy || !selected}>
            Criar e abrir
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
