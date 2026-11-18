import { useState, type FormEvent } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { Field } from "../../components/ui/Field";
import { errorMessage } from "../../lib/api";

interface Props {
  open: boolean;
  mode: "create" | "rename";
  initialName?: string;
  onSubmit: (name: string, description: string) => Promise<void>;
  onClose: () => void;
}

export function NameDialog({ open, mode, initialName = "", onSubmit, onClose }: Props) {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(name, description);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} title={mode === "create" ? "Nova automação" : "Renomear automação"} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Nome" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={100} />
        {mode === "create" && (
          <Field label="Descrição (opcional)" value={description} onChange={(e) => setDescription(e.target.value)} />
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancelar</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {mode === "create" ? "Criar" : "Salvar"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
