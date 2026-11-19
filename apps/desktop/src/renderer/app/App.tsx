import { useEffect, useState } from "react";
import { Sidebar, type Page } from "../components/Sidebar";
import { Button } from "../components/ui/Button";
import { Dialog } from "../components/ui/Dialog";
import { AutomationsPage } from "../features/automations/AutomationsPage";
import { Dashboard } from "../features/dashboard/Dashboard";
import { HistoryPage } from "../features/history/HistoryPage";
import { EditorPage } from "../features/editor/EditorPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { useAutomations } from "../stores/automations";
import { isDirty, useEditor } from "../stores/editor";
import { useEngine } from "../stores/engine";
import { useRun } from "../stores/run";
import { useSettings } from "../stores/settings";

function useApplyTheme() {
  const theme = useSettings((s) => s.theme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
}

type View = { page: "dashboard" | "automations" | "history" | "settings"; createOnOpen?: boolean } | { page: "editor"; automationId: string };

export function App() {
  const [view, setView] = useState<View>({ page: "dashboard" });
  const [pending, setPending] = useState<View | null>(null); // destino aguardando decisão sobre alterações não salvas
  const [leaving, setLeaving] = useState(false);
  useApplyTheme();

  useEffect(() => {
    void useAutomations.getState().load();
    void useSettings.getState().load();
    const offEngine = useEngine.getState().init();
    const offRun = useRun.getState().init();
    return () => {
      offEngine();
      offRun();
    };
  }, []);

  /** Troca de tela; se o editor tem alterações não salvas, pergunta antes. */
  const go = (next: View) => {
    if (view.page === "editor" && isDirty(useEditor.getState())) setPending(next);
    else setView(next);
  };
  const finishLeaving = (next: View) => {
    setPending(null);
    setView(next);
  };

  const navPage: Page = view.page === "editor" ? "automations" : view.page;

  return (
    <div className="flex h-screen">
      <Sidebar page={navPage} onNavigate={(p) => go({ page: p })} />
      <main className={view.page === "editor" ? "min-w-0 flex-1 overflow-hidden" : "flex-1 overflow-auto p-8"}>
        {view.page === "dashboard" && <Dashboard onCreate={() => go({ page: "automations", createOnOpen: true })} />}
        {view.page === "automations" && (
          <AutomationsPage openCreate={view.createOnOpen} onOpen={(id) => go({ page: "editor", automationId: id })} />
        )}
        {view.page === "history" && <HistoryPage />}
        {view.page === "settings" && <SettingsPage />}
        {view.page === "editor" && <EditorPage automationId={view.automationId} onBack={() => go({ page: "automations" })} />}
      </main>

      <Dialog open={pending !== null} title="Alterações não salvas" onClose={() => setPending(null)}>
        <p>Este fluxo tem alterações que ainda não foram salvas.</p>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setPending(null)}>Continuar editando</Button>
          <Button variant="danger" onClick={() => pending && finishLeaving(pending)}>
            Descartar alterações
          </Button>
          <Button
            variant="primary"
            disabled={leaving}
            onClick={async () => {
              setLeaving(true);
              const ok = await useEditor.getState().save();
              setLeaving(false);
              if (ok && pending) finishLeaving(pending);
            }}
          >
            Salvar e sair
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
