import { CATEGORIES, NODE_DEFINITIONS } from "@automation-studio/node-registry";
import { useState } from "react";
import { currentDoc, useEditor } from "../../stores/editor";
import { useAddNode } from "./useAddNode";

export const DND_MIME = "application/x-automation-node";

export function NodePalette() {
  const doc = useEditor(currentDoc)!;
  const add = useAddNode();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  return (
    <aside aria-label="Biblioteca de nós" className="flex w-60 shrink-0 flex-col gap-3 overflow-auto border-r border-line bg-panel p-3">
      <input
        type="search"
        aria-label="Buscar nó"
        placeholder="Buscar nó…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="rounded-md border border-line bg-bg px-3 py-1.5 text-sm"
      />
      <p className="text-xs text-muted">Arraste para o canvas ou clique para adicionar.</p>
      {CATEGORIES.map((c) => {
        const items = NODE_DEFINITIONS.filter((d) => d.category === c.id && (!q || d.label.toLowerCase().includes(q)));
        if (items.length === 0) return null;
        return (
          <section key={c.id} aria-label={c.label}>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{c.label}</h3>
            <ul className="flex flex-col gap-1">
              {items.map((d) => {
                const blocked = d.unique && doc.nodes.some((n) => n.type === d.type);
                return (
                  <li key={d.type}>
                    <button
                      type="button"
                      draggable={!blocked}
                      disabled={blocked}
                      title={blocked ? `${d.description} (já existe no fluxo)` : d.description}
                      onClick={() => add(d.type)}
                      onDragStart={(e) => {
                        e.dataTransfer.setData(DND_MIME, d.type);
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      className="w-full cursor-grab rounded-md border border-line bg-bg px-2.5 py-1.5 text-left text-sm hover:border-brand disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {d.label}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </aside>
  );
}
