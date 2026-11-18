import { useEffect, useState } from "react";
import { Sidebar, type Page } from "../components/Sidebar";
import { AutomationsPage } from "../features/automations/AutomationsPage";
import { Dashboard } from "../features/dashboard/Dashboard";
import { SettingsPage } from "../features/settings/SettingsPage";
import { useAutomations } from "../stores/automations";
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

export function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const [createOnOpen, setCreateOnOpen] = useState(false);
  useApplyTheme();

  useEffect(() => {
    void useAutomations.getState().load();
    void useSettings.getState().load();
  }, []);

  const navigate = (p: Page) => {
    setCreateOnOpen(false);
    setPage(p);
  };

  return (
    <div className="flex h-screen">
      <Sidebar page={page} onNavigate={navigate} />
      <main className="flex-1 overflow-auto p-8">
        {page === "dashboard" && (
          <Dashboard
            onCreate={() => {
              setCreateOnOpen(true);
              setPage("automations");
            }}
          />
        )}
        {page === "automations" && <AutomationsPage openCreate={createOnOpen} />}
        {page === "settings" && <SettingsPage />}
      </main>
    </div>
  );
}
