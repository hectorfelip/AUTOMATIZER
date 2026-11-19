import { useState } from "react";
import type { PluginPreview, PluginSummary } from "@automation-studio/shared-types";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { errorMessage } from "../../lib/api";
import { usePlugins } from "../../stores/plugins";

export function PluginsPage() {
  const { items, loadError, preview, confirm, setEnabled, remove } = usePlugins();
  const [pv, setPv] = useState<PluginPreview | null>(null);
  const [del, setDel] = useState<PluginSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Plugins</h1>
        <Button
          variant="primary"
          onClick={() =>
            void run(async () => {
              setNotice(null);
              setPv(await preview()); // null = o usuário cancelou o diálogo
            })
          }
        >
          Instalar plugin…
        </Button>
      </header>
      <p className="text-sm text-muted">
        Um plugin cria um <strong>nó novo</strong> combinando nós que o aplicativo já tem; <strong>não traz código</strong> e nunca é instalado sozinho. Os nós aparecem na paleta, na categoria “Plugins”.
      </p>
      {(loadError || error) && (
        <p role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
          {loadError ?? error}
        </p>
      )}
      {notice && (
        <p role="status" data-testid="plugin-notice" className="rounded-md border border-line p-3 text-sm">
          {notice}
        </p>
      )}
      {items.length === 0 && <p className="rounded-md border border-dashed border-line p-8 text-center text-muted">Nenhum plugin instalado.</p>}
      <ul className="flex flex-col gap-2" data-testid="plugin-list">
        {items.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-4" data-testid={`plugin-${p.id}`}>
            <div className="flex items-center gap-2">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs text-muted">v{p.version}</span>
              <Badge tone={p.enabled ? "ok" : "muted"}>{p.enabled ? "Ativo" : "Desativado"}</Badge>
            </div>
            {p.description && <p className="text-sm">{p.description}</p>}
            <p className="text-xs text-muted">
              Nó <code>{p.nodeType}</code> · {p.fieldCount} campo(s) · devolve: {p.returns.length ? p.returns.join(", ") : "nada"} · {p.nodeCount} nó(s) internos · usado em {p.usedBy} automação(ões)
            </p>
            {p.problem && <p className="text-xs text-danger">{p.problem}</p>}
            <div className="flex gap-2">
              <Button size="sm" aria-label={`${p.enabled ? "Desativar" : "Ativar"} plugin ${p.name}`} onClick={() => void run(() => setEnabled(p.id, !p.enabled))}>
                {p.enabled ? "Desativar" : "Ativar"}
              </Button>
              <Button size="sm" variant="danger" aria-label={`Remover plugin ${p.name}`} onClick={() => setDel(p)}>
                Remover
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog open={pv !== null} title="Instalar plugin" onClose={() => setPv(null)}>
        {pv && (
          <>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1 text-sm" data-testid="plugin-summary">
              <dt className="text-muted">Arquivo</dt>
              <dd className="break-all">{pv.fileName}</dd>
              <dt className="text-muted">Plugin</dt>
              <dd>
                {pv.name} (v{pv.version})
              </dd>
              <dt className="text-muted">Nó criado</dt>
              <dd>
                <code>{pv.nodeType}</code> com {pv.fieldCount} campo(s)
              </dd>
              <dt className="text-muted">Devolve</dt>
              <dd>{pv.returns.length ? pv.returns.join(", ") : "nada"}</dd>
              <dt className="text-muted">Por dentro</dt>
              <dd>{pv.nodeCount} nó(s) embutidos (nenhum código)</dd>
            </dl>
            {pv.description && <p className="text-sm">{pv.description}</p>}
            {pv.replacesVersion && (
              <p role="note" className="rounded-md border border-line p-2 text-sm">
                Já existe este plugin (v{pv.replacesVersion}); instalar vai <strong>substituí-lo</strong>.
              </p>
            )}
            <p className="text-sm text-muted">O plugin só combina ações que o aplicativo já permite; ele não executa nada ao ser instalado.</p>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setPv(null)}>Cancelar</Button>
              <Button
                variant="primary"
                onClick={() => {
                  const t = pv.token;
                  const n = pv.name;
                  setPv(null);
                  void run(async () => {
                    await confirm(t);
                    setNotice(`Plugin “${n}” instalado. O nó está na paleta, em “Plugins”.`);
                  });
                }}
              >
                Instalar
              </Button>
            </div>
          </>
        )}
      </Dialog>
      <Dialog open={del !== null} title="Remover plugin" onClose={() => setDel(null)}>
        <p>
          Remover <strong>{del?.name}</strong>?{" "}
          {del && del.usedBy > 0 ? `Ele é usado em ${del.usedBy} automação(ões), que deixarão de executar até você reinstalá-lo.` : "Nenhuma automação o usa."}
        </p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setDel(null)}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={() => {
              const t = del;
              setDel(null);
              if (t) void run(() => remove(t.id));
            }}
          >
            Remover
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
