import { useState } from "react";
import type { ImportPreview } from "@automation-studio/shared-types";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { errorMessage, unwrap } from "../../lib/api";
import { useAutomations } from "../../stores/automations";

interface Props {
  preview: ImportPreview | null;
  onClose: () => void;
  /** Importado com sucesso (a página só avisa; nada é executado). */
  onImported: (name: string) => void;
}

/** Resumo do arquivo ANTES de importar. Confirmar só cria a automação; nunca executa. */
export function ImportDialog({ preview, onClose, onImported }: Props) {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownName = name ?? preview?.name ?? "";

  const close = () => {
    setName(null);
    setError(null);
    onClose();
  };
  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      const created = await unwrap((a) => a.exchange.importConfirm({ token: preview.token, name: shownName.trim() || undefined }));
      await useAutomations.getState().load();
      close();
      onImported(created.name);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={preview !== null} title="Importar fluxo" onClose={close}>
      {preview && (
        <>
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm" data-testid="import-summary">
            <dt className="text-muted">Arquivo</dt>
            <dd className="break-all">{preview.fileName}</dd>
            <dt className="text-muted">Exportado em</dt>
            <dd>
              {new Date(preview.exportedAt).toLocaleString("pt-BR")} (app {preview.appVersion})
            </dd>
            <dt className="text-muted">Conteúdo</dt>
            <dd>
              {preview.nodeCount} nó(s), {preview.edgeCount} conexão(ões), {preview.variableCount} variável(is)
            </dd>
            <dt className="text-muted">Execução</dt>
            <dd>
              Tempo limite {preview.timeoutSeconds} s · {preview.errorPolicy === "stop" ? "para na primeira falha" : "continua após falhas"}
            </dd>
          </dl>
          <ul className="flex flex-wrap gap-1 text-xs" aria-label="Nós usados">
            {preview.nodes.map((n) => (
              <li key={n.label} className="rounded-full border border-line px-2 py-0.5">
                {n.label} × {n.count}
              </li>
            ))}
          </ul>
          {preview.windowsOnly && (
            <p role="note" className="rounded-md border border-line p-2 text-sm">
              Este fluxo usa ações de janela, teclado ou mouse, que só funcionam no Windows.
            </p>
          )}
          {preview.issues.errors + preview.issues.warnings > 0 && (
            <div role="note" className="rounded-md border border-danger p-2 text-sm" data-testid="import-issues">
              <p className="font-medium">
                {preview.issues.errors} erro(s) e {preview.issues.warnings} aviso(s) no fluxo. Você pode importar e corrigir no editor; ele só executa sem erros.
              </p>
              <ul className="list-disc pl-5 text-muted">
                {preview.issues.first.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <label className="flex flex-col gap-1 text-sm">
            Nome da automação
            <input className="rounded-md border border-line bg-bg px-2 py-1 text-fg" value={shownName} maxLength={100} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="text-sm text-muted">Importar apenas cria a automação. Ela nunca é executada automaticamente.</p>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={close}>Cancelar</Button>
            <Button variant="primary" disabled={busy || shownName.trim() === ""} onClick={() => void confirm()}>
              Importar
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}
