import { useState } from "react";
import { THEMES, type Theme } from "@automation-studio/shared-types";
import { errorMessage } from "../../lib/api";
import { useSettings } from "../../stores/settings";

const labels: Record<Theme, string> = { system: "Seguir o sistema", light: "Claro", dark: "Escuro" };

export function SettingsPage() {
  const { theme, info, setTheme } = useSettings();
  const [error, setError] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Configurações</h1>

      <fieldset className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-5">
        <legend className="px-1 text-sm font-medium text-muted">Tema</legend>
        {THEMES.map((t) => (
          <label key={t} className="flex items-center gap-2">
            <input
              type="radio"
              name="theme"
              checked={theme === t}
              onChange={() => {
                setError(null);
                setTheme(t).catch((e) => setError(errorMessage(e)));
              }}
            />
            {labels[t]}
          </label>
        ))}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </fieldset>

      <section aria-label="Sobre" className="rounded-lg border border-line bg-panel p-5">
        <h2 className="text-sm font-medium text-muted">Sobre</h2>
        <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-y-1">
          <dt className="text-muted">Versão</dt>
          <dd>{info?.version ?? "—"}</dd>
          <dt className="text-muted">Dados em</dt>
          <dd className="break-all">{info?.dataPath ?? "—"}</dd>
        </dl>
      </section>
    </section>
  );
}
