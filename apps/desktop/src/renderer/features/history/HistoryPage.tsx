import { useEffect, useState } from "react";
import type { LogLevel } from "@automation-studio/shared-types";
import { getNodeDefinition } from "@automation-studio/node-registry";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";
import { errorMessage, unwrap } from "../../lib/api";
import { formatDuration, formatWhen, MODE_LABEL, STATUS_LABEL, STATUS_TONE } from "../../lib/status";
import { useAutomations } from "../../stores/automations";
import { useHistory, type Period } from "../../stores/history";
import { SnapshotView } from "../editor/SnapshotView";

const sel = "rounded-md border border-line bg-bg px-2 py-1 text-sm text-fg";
const PERIODS: [Period, string][] = [["all", "Todo o período"], ["1", "Últimas 24 horas"], ["7", "Últimos 7 dias"], ["30", "Últimos 30 dias"]];
const LEVEL_LABEL: Record<LogLevel, string> = { info: "Info", warn: "Aviso", error: "Erro" };

function Detail() {
  const { detail, detailError, closeDetail } = useHistory();
  const [level, setLevel] = useState<LogLevel | "all">("all");
  const [image, setImage] = useState<{ seq: number; src: string } | { seq: number; error: string } | null>(null);
  useEffect(() => {
    setLevel("all");
    setImage(null);
  }, [detail?.summary.id]);
  if (detailError) {
    return (
      <p role="alert" className="rounded-md border border-danger p-3 text-sm text-danger">
        {detailError}
      </p>
    );
  }
  if (!detail) return null;
  const { summary: s, logs } = detail;
  const labelOf = (id: string | null) => {
    const type = detail.document.nodes.find((n) => n.id === id)?.type;
    return type ? (getNodeDefinition(type)?.label ?? type) : (id ?? "");
  };
  const shown = logs.filter((l) => level === "all" || l.level === level);
  const showImage = async (seq: number) => {
    try {
      setImage({ seq, src: await unwrap((a) => a.history.diagnostic({ executionId: s.id, seq })) });
    } catch (e) {
      setImage({ seq, error: errorMessage(e) });
    }
  };
  return (
    <section aria-label="Detalhes da execução" className="flex flex-col gap-3 rounded-lg border border-line bg-panel p-5" data-testid="history-detail">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{s.workflowName}</h2>
          <p className="text-sm text-muted">
            {formatWhen(s.startedAt)} · {MODE_LABEL[s.mode] ?? s.mode} · {formatDuration(s.durationMs)} · {s.versionNumber ? `versão ${s.versionNumber}` : "rascunho (não era uma versão salva)"}
          </p>
        </div>
        <Button size="sm" onClick={closeDetail}>
          Fechar
        </Button>
      </div>
      <div className="flex items-center gap-2">
        <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
        {s.warnings > 0 && <span className="text-sm text-muted">{s.warnings} nó(s) ignorados por falha</span>}
      </div>
      {s.errorMessage && (
        <div role="alert" className="rounded-md border border-danger p-2 text-sm text-danger" data-testid="history-error">
          {s.errorNodeId && <p className="font-medium">Nó que falhou: {labelOf(s.errorNodeId)}</p>}
          <p>{s.errorMessage}</p>
        </div>
      )}
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-medium">Log ({logs.length})</h3>
        <select aria-label="Nível do log" className={sel} value={level} onChange={(e) => setLevel(e.target.value as LogLevel | "all")}>
          <option value="all">Todos os níveis</option>
          <option value="error">Só erros</option>
          <option value="warn">Só avisos</option>
          <option value="info">Só informações</option>
        </select>
      </div>
      <ol className="flex max-h-72 flex-col gap-1 overflow-auto text-sm" data-testid="history-logs">
        {shown.map((l) => (
          <li key={l.seq} className="flex flex-wrap items-baseline gap-2">
            <span className="text-xs text-muted">{new Date(l.timestamp).toLocaleTimeString("pt-BR")}</span>
            <span className={`text-xs font-medium ${l.level === "error" ? "text-danger" : "text-muted"}`}>{LEVEL_LABEL[l.level]}</span>
            <span>{l.message}</span>
            {l.hasDiagnostic && (
              <Button size="sm" onClick={() => void showImage(l.seq)}>
                Ver captura da tela
              </Button>
            )}
          </li>
        ))}
        {shown.length === 0 && <li className="text-muted">Nenhuma entrada neste nível.</li>}
      </ol>
      {image && ("error" in image ? <p role="alert" className="text-sm text-danger">{image.error}</p> : <img src={image.src} alt="Captura da tela no momento da falha" className="max-h-80 rounded-md border border-line object-contain" />)}
      {detail.snapshot && (
        <details className="rounded-md border border-line p-2">
          <summary className="cursor-pointer text-sm font-medium">Variáveis e resultados no fim</summary>
          <div className="mt-2">
            <SnapshotView snapshot={detail.snapshot} />
          </div>
        </details>
      )}
    </section>
  );
}

export function HistoryPage() {
  const { items, total, stats, filter, loading, error, setFilter, load, open, clear, detail } = useHistory();
  const automations = useAutomations((s) => s.items);
  const [confirm, setConfirm] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Histórico</h1>
        <Button variant="danger" size="sm" disabled={total === 0 && !stats?.total} onClick={() => setConfirm(true)}>
          Limpar histórico
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filtros do histórico">
        <select aria-label="Automação" className={sel} value={filter.automationId} onChange={(e) => void setFilter({ automationId: e.target.value })}>
          <option value="">Todas as automações</option>
          {automations.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <select aria-label="Resultado" className={sel} value={filter.status} onChange={(e) => void setFilter({ status: e.target.value as typeof filter.status })}>
          <option value="all">Todos os resultados</option>
          {(["completed", "completed_with_warnings", "failed", "cancelled", "running", "paused"] as const).map((k) => (
            <option key={k} value={k}>
              {STATUS_LABEL[k]}
            </option>
          ))}
        </select>
        <select aria-label="Período" className={sel} value={filter.period} onChange={(e) => void setFilter({ period: e.target.value as Period })}>
          {PERIODS.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
        {stats && (
          <span className="text-sm text-muted" data-testid="history-stats">
            {stats.total} no período: {stats.completed} concluídas, {stats.completedWithWarnings} com avisos, {stats.failed} falhas, {stats.cancelled} canceladas
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-4">
        <div>
          {items.length === 0 ? (
            <p className="text-muted" data-testid="history-empty">
              {loading ? "Carregando…" : "Nenhuma execução encontrada."}
            </p>
          ) : (
            <ul className="flex flex-col gap-2" data-testid="history-list">
              {items.map((e) => (
                <li key={e.id}>
                  <button
                    type="button"
                    onClick={() => void open(e.id)}
                    aria-current={detail?.summary.id === e.id}
                    data-testid={`history-item-${e.id}`}
                    className={`flex w-full flex-col gap-1 rounded-md border bg-panel p-3 text-left hover:bg-bg ${detail?.summary.id === e.id ? "border-brand" : "border-line"}`}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{e.workflowName}</span>
                      <Badge tone={STATUS_TONE[e.status]}>{STATUS_LABEL[e.status]}</Badge>
                    </span>
                    <span className="text-xs text-muted">
                      {formatWhen(e.startedAt)} · {formatDuration(e.durationMs)}
                    </span>
                    {e.errorMessage && <span className="truncate text-xs text-danger">{e.errorMessage}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {total > items.length && (
            <Button size="sm" className="mt-2" onClick={() => void load(items.length + 50)}>
              Mostrar mais ({total - items.length})
            </Button>
          )}
        </div>
        <Detail />
      </div>
      <Dialog open={confirm} title="Limpar o histórico?" onClose={() => setConfirm(false)}>
        <p>Isso apaga todas as execuções registradas (e as capturas de tela guardadas). As automações e suas versões não são afetadas. Não dá para desfazer.</p>
        {clearError && (
          <p role="alert" className="text-sm text-danger">
            {clearError}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirm(false)}>Cancelar</Button>
          <Button
            variant="danger"
            onClick={() => {
              setClearError(null);
              clear().then(() => setConfirm(false), (e) => setClearError(errorMessage(e)));
            }}
          >
            Apagar tudo
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
