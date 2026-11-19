import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { PluginPreview, PluginSummary } from "@automation-studio/shared-types";
import { setPluginNodes } from "@automation-studio/node-registry";
import { MAX_PLUGIN_BYTES, parsePlugin } from "@automation-studio/workflow-validator";
import { AppError } from "./errors.js";
import type { ExchangeIO } from "./exchange.js";

interface Deps {
  io: Pick<ExchangeIO, "pickOpenPath" | "statSize" | "readText" | "baseName">;
  now?: () => string;
  newToken?: () => string;
  ttlMs?: number;
  clock?: () => number;
}

type Row = { id: string; name: string; version: string; enabled: number; source_json: string; installed_at: string };

/** Plugins DECLARATIVOS (ADR 0014): só entram por importação manual, com resumo antes e confirmação. Nunca executam código. */
export function createPluginService(db: DatabaseSync, { io, now = () => new Date().toISOString(), newToken = randomUUID, ttlMs = 15 * 60_000, clock = Date.now }: Deps) {
  const pending = new Map<string, { text: string; at: number }>();
  const rows = () => db.prepare("SELECT * FROM plugins ORDER BY name COLLATE NOCASE, id").all() as Row[];
  const get = (id: string): Row => {
    const r = db.prepare("SELECT * FROM plugins WHERE id = ?").get(id) as Row | undefined;
    if (!r) throw new AppError("NOT_FOUND", "Plugin não encontrado. Ele pode ter sido removido.");
    return r;
  };
  const usedBy = (id: string): number =>
    (
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM automations a JOIN workflow_versions v ON v.automation_id = a.id AND v.version_number = a.current_version WHERE v.definition_json LIKE ?",
        )
        .get(`%"type":"plugin.${id}"%`) as { n: number }
    ).n;

  const service = {
    /** Registra no registro de nós os plugins ATIVOS (chamar na inicialização e após qualquer mudança). */
    apply(): void {
      const defs = [];
      for (const r of rows()) {
        if (r.enabled !== 1) continue;
        const p = parsePlugin(r.source_json);
        if (p.ok) defs.push(p.node); // um plugin corrompido no banco é ignorado, nunca derruba o app
      }
      setPluginNodes(defs);
    },

    list(): PluginSummary[] {
      return rows().map((r) => {
        const p = parsePlugin(r.source_json);
        return {
          id: r.id,
          name: r.name,
          version: r.version,
          description: p.ok ? p.info.description : "",
          enabled: r.enabled === 1,
          installedAt: r.installed_at,
          nodeType: `plugin.${r.id}`,
          fieldCount: p.ok ? p.info.fieldCount : 0,
          returns: p.ok ? p.info.returns : [],
          nodeCount: p.ok ? p.info.nodeCount : 0,
          usedBy: usedBy(r.id),
          problem: p.ok ? null : "O plugin salvo não pôde ser lido e foi ignorado.",
        };
      });
    },

    /** Fontes dos plugins ativos: o renderer valida com o MESMO código e monta os nós dele. */
    sources: (): { id: string; text: string }[] => rows().filter((r) => r.enabled === 1).map((r) => ({ id: r.id, text: r.source_json })),

    async importPreview(): Promise<PluginPreview | null> {
      const path = await io.pickOpenPath("plugin");
      if (!path) return null;
      let text: string;
      try {
        if (io.statSize(path) > MAX_PLUGIN_BYTES) throw new AppError("VALIDATION", "O arquivo é grande demais para ser um plugin.");
        text = io.readText(path);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError("IO_ERROR", "Não foi possível ler o arquivo. Verifique se ele existe e se você tem permissão.");
      }
      const p = parsePlugin(text);
      if (!p.ok) throw new AppError("VALIDATION", p.message);
      for (const [k, v] of pending) if (clock() - v.at > ttlMs) pending.delete(k);
      pending.clear(); // uma importação pendente por vez
      const token = newToken();
      pending.set(token, { text, at: clock() });
      const existing = db.prepare("SELECT version FROM plugins WHERE id = ?").get(p.info.id) as { version: string } | undefined;
      return { token, fileName: io.baseName(path), ...p.info, replacesVersion: existing?.version ?? null };
    },

    /** Instala (ou substitui, mantendo o estado ativo/inativo). Não executa nada. */
    importConfirm(token: string): PluginSummary {
      const entry = pending.get(token);
      if (!entry || clock() - entry.at > ttlMs) {
        pending.delete(token);
        throw new AppError("NOT_FOUND", "A importação expirou ou já foi concluída. Escolha o arquivo novamente.");
      }
      const p = parsePlugin(entry.text); // revalida (defesa em profundidade)
      if (!p.ok) throw new AppError("VALIDATION", p.message);
      const prev = db.prepare("SELECT enabled FROM plugins WHERE id = ?").get(p.info.id) as { enabled: number } | undefined;
      db.prepare("INSERT OR REPLACE INTO plugins (id, name, version, enabled, source_json, installed_at) VALUES (?, ?, ?, ?, ?, ?)").run(
        p.info.id,
        p.info.name,
        p.info.version,
        prev?.enabled ?? 1,
        entry.text,
        now(),
      );
      pending.delete(token);
      service.apply();
      return service.list().find((s) => s.id === p.info.id)!;
    },

    setEnabled(id: string, enabled: boolean): PluginSummary {
      get(id);
      db.prepare("UPDATE plugins SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
      service.apply();
      return service.list().find((s) => s.id === id)!;
    },

    remove(id: string): null {
      get(id);
      db.prepare("DELETE FROM plugins WHERE id = ?").run(id);
      service.apply();
      return null;
    },
  };
  return service;
}
export type PluginService = ReturnType<typeof createPluginService>;
