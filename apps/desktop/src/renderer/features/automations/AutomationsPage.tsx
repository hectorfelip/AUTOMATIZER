import { useState } from "react";
import type { Automation, ImportPreview } from "@automation-studio/shared-types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { errorMessage, unwrap } from "../../lib/api";
import { useAutomations } from "../../stores/automations";
import { ImportDialog } from "./ImportDialog";
import { NameDialog } from "./NameDialog";
import { TemplateDialog } from "./TemplateDialog";

type Dlg = { kind: "create" } | { kind: "template" } | { kind: "rename"; item: Automation } | { kind: "delete"; item: Automation } | null;

const fmt = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export function AutomationsPage({ openCreate = false, onOpen }: { openCreate?: boolean; onOpen: (id: string) => void }) {
  const { items, loaded, loadError, create, rename, archive, restore, remove, load } = useAutomations();
  const [tab, setTab] = useState<"active" | "archived">("active");
  const [dialog, setDialog] = useState<Dlg>(openCreate ? { kind: "create" } : null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  const shown = items.filter((a) => a.status === tab);
  const count = (s: Automation["status"]) => items.filter((a) => a.status === s).length;
  const close = () => setDialog(null);

  const run = async (fn: () => Promise<void>) => {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const startImport = () =>
    void run(async () => {
      setNotice(null);
      setPreview(await unwrap((a) => a.exchange.importPreview())); // null = o usuário cancelou o diálogo
    });
  const exportOne = (a: Automation) =>
    void run(async () => {
      setNotice(null);
      const res = await unwrap((api) => api.exchange.exportWorkflow({ automationId: a.id }));
      if (res) setNotice(`“${a.name}” exportada para ${res.path}.`);
    });

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automações</h1>
        <div className="flex gap-2">
          <Button onClick={startImport}>Importar…</Button>
          <Button onClick={() => setDialog({ kind: "template" })}>Novo a partir de exemplo</Button>
          <Button variant="primary" onClick={() => setDialog({ kind: "create" })}>
            Nova automação
          </Button>
        </div>
      </header>

      <div role="group" aria-label="Filtro de estado" className="flex gap-2">
        {(["active", "archived"] as const).map((t) => (
          <Button key={t} size="sm" variant={tab === t ? "primary" : "secondary"} aria-pressed={tab === t} onClick={() => setTab(t)}>
            {`${t === "active" ? "Ativas" : "Arquivadas"} (${count(t)})`}
          </Button>
        ))}
      </div>

      {loadError && (
        <div role="alert" className="flex items-center gap-3 rounded-md border border-danger p-3 text-danger">
          <span>{loadError}</span>
          <Button size="sm" onClick={() => void load()}>
            Tentar novamente
          </Button>
        </div>
      )}
      {notice && (
        <p role="status" data-testid="exchange-notice" className="rounded-md border border-line p-3 text-sm">
          {notice}
        </p>
      )}
      {actionError && (
        <p role="alert" className="rounded-md border border-danger p-3 text-danger">
          {actionError}
        </p>
      )}

      {loaded && !loadError && shown.length === 0 && (
        <p className="rounded-md border border-dashed border-line p-8 text-center text-muted">
          {tab === "active" ? "Nenhuma automação ativa. Crie a primeira em “Nova automação”." : "Nenhuma automação arquivada."}
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {shown.map((a) => (
          <li key={a.id} className="flex items-center gap-4 rounded-lg border border-line bg-panel p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate font-medium">{a.name}</span>
                <Badge tone={a.status === "active" ? "ok" : "muted"}>{a.status === "active" ? "Ativa" : "Arquivada"}</Badge>
              </div>
              {a.description && <p className="truncate text-sm text-muted">{a.description}</p>}
              <p className="text-xs text-muted">Atualizada em {fmt(a.updatedAt)}</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" aria-label={`Abrir ${a.name}`} onClick={() => onOpen(a.id)}>
                Abrir
              </Button>
              <Button size="sm" aria-label={`Exportar ${a.name}`} onClick={() => exportOne(a)}>
                Exportar
              </Button>
              <Button size="sm" aria-label={`Renomear ${a.name}`} onClick={() => setDialog({ kind: "rename", item: a })}>
                Renomear
              </Button>
              {a.status === "active" ? (
                <Button size="sm" aria-label={`Arquivar ${a.name}`} onClick={() => void run(() => archive(a.id))}>
                  Arquivar
                </Button>
              ) : (
                <Button size="sm" aria-label={`Restaurar ${a.name}`} onClick={() => void run(() => restore(a.id))}>
                  Restaurar
                </Button>
              )}
              <Button size="sm" variant="danger" aria-label={`Excluir ${a.name}`} onClick={() => setDialog({ kind: "delete", item: a })}>
                Excluir
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <NameDialog
        key={dialog?.kind === "rename" ? dialog.item.id : dialog?.kind ?? "closed"}
        open={dialog?.kind === "create" || dialog?.kind === "rename"}
        mode={dialog?.kind === "rename" ? "rename" : "create"}
        initialName={dialog?.kind === "rename" ? dialog.item.name : ""}
        onClose={close}
        onSubmit={(name, description) =>
          dialog?.kind === "rename" ? rename(dialog.item.id, name) : create(name, description)
        }
      />

      <ImportDialog preview={preview} onClose={() => setPreview(null)} onImported={(n) => setNotice(`“${n}” importada. Ela não foi executada; abra e revise antes de rodar.`)} />
      <TemplateDialog open={dialog?.kind === "template"} onClose={close} onCreated={onOpen} />

      <Dialog open={dialog?.kind === "delete"} title="Excluir automação" onClose={close}>
        <p>
          Excluir <strong>{dialog?.kind === "delete" ? dialog.item.name : ""}</strong>? Esta ação não pode ser desfeita.
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
            Excluir definitivamente
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
