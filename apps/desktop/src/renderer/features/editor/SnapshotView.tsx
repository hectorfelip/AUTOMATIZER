import type { ContextSnapshot, Preview } from "@automation-studio/shared-types";

/** Valor limitado do contexto como texto curto e legível. */
export function previewText(p: Preview): string {
  if (p === null) return "(vazio)";
  if (typeof p === "object") {
    if (p.type === "list") return `lista (${p.count}): [${p.items.map(previewText).join(", ")}${p.count > p.items.length ? ", …" : ""}]`;
    return `{ ${Object.entries(p.fields).map(([k, v]) => `${k}: ${previewText(v)}`).join(", ")} }`;
  }
  return typeof p === "string" ? `“${p}”` : String(p);
}

/** Variáveis, itens de laço e resultados dos nós no ponto atual da execução (somente leitura). */
export function SnapshotView({ snapshot }: { snapshot: ContextSnapshot }) {
  const vars = Object.entries(snapshot.variables);
  return (
    <div className="flex flex-col gap-2 text-xs" data-testid="snapshot">
      <section aria-label="Variáveis na execução">
        <h3 className="font-medium">Variáveis</h3>
        {vars.length === 0 ? (
          <p className="text-muted">Nenhuma.</p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-2">
            {vars.map(([k, v]) => (
              <div key={k} className="contents" data-testid={`snap-var-${k}`}>
                <dt className="font-mono text-muted">{k}</dt>
                <dd className="break-all">{typeof v === "string" ? `“${v}”` : String(v)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
      {snapshot.loops.length > 0 && (
        <section aria-label="Laços ativos">
          <h3 className="font-medium">Laços ativos</h3>
          <ul>
            {snapshot.loops.map((l) => (
              <li key={l.name}>
                <span className="font-mono text-muted">{l.name}</span> — item {l.index + 1} de {l.count}: {previewText(l.item)}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section aria-label="Resultados dos nós">
        <h3 className="font-medium">Resultados dos nós</h3>
        {snapshot.results.length === 0 ? (
          <p className="text-muted">Nenhum ainda.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {snapshot.results.map((r) => (
              <li key={r.nodeId}>
                <span className="font-medium">{r.label}</span>
                {Object.keys(r.outputs).length === 0 ? (
                  <span className="text-muted"> — sem resultado</span>
                ) : (
                  <ul className="ml-3">
                    {Object.entries(r.outputs).map(([k, v]) => (
                      <li key={k} className="break-all">
                        <span className="font-mono text-muted">{k}</span>: {previewText(v)}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
