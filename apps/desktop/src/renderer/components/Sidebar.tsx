export type Page = "dashboard" | "automations" | "plugins" | "schedules" | "history" | "settings";

const items: { page: Page; label: string }[] = [
  { page: "dashboard", label: "Dashboard" },
  { page: "automations", label: "Automações" },
  { page: "plugins", label: "Plugins" },
  { page: "schedules", label: "Agendamentos" },
  { page: "history", label: "Histórico" },
  { page: "settings", label: "Configurações" },
];

export function Sidebar({ page, onNavigate }: { page: Page; onNavigate: (p: Page) => void }) {
  return (
    <aside className="flex w-56 shrink-0 flex-col gap-6 border-r border-line bg-panel p-4">
      <div className="px-2 text-lg font-semibold">Automation Studio</div>
      <nav aria-label="Principal" className="flex flex-col gap-1">
        {items.map(({ page: p, label }) => (
          <button
            key={p}
            type="button"
            aria-current={p === page ? "page" : undefined}
            onClick={() => onNavigate(p)}
            className={`rounded-md px-3 py-2 text-left font-medium ${p === page ? "bg-brand text-brand-fg" : "hover:bg-bg"}`}
          >
            {label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
