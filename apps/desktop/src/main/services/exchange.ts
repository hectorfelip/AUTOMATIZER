import { randomUUID } from "node:crypto";
import type { Automation, ExportResult, ImportPreview } from "@automation-studio/shared-types";
import { getNodeDefinition } from "@automation-studio/node-registry";
import { MAX_IMPORT_BYTES, buildExport, parseExchange, type ExchangeFile } from "@automation-studio/workflow-schema";
import { validateWorkflow } from "@automation-studio/workflow-validator";
import { AppError } from "./errors.js";
import type { AutomationService } from "./automations.js";
import type { WorkflowService } from "./workflows.js";

/** Tudo que toca o disco/diálogos entra por aqui, para o serviço ser testável sem Electron. */
export interface ExchangeIO {
  /** Abre "Salvar como"; null = cancelado. */
  pickSavePath(defaultName: string): Promise<string | null>;
  /** Abre "Abrir"; null = cancelado. */
  pickOpenPath(kind?: "workflow" | "plugin"): Promise<string | null>;
  statSize(path: string): number;
  readText(path: string): string;
  writeText(path: string, text: string): void;
  baseName(path: string): string;
}

interface Deps {
  automations: AutomationService;
  workflows: WorkflowService;
  io: ExchangeIO;
  appVersion: string;
  newToken?: () => string;
  /** Prévias esquecidas após este tempo (padrão 15 min). */
  ttlMs?: number;
  now?: () => number;
}

const WINDOWS_CATEGORIES = new Set(["windows", "input", "vision"]);
const safeFileName = (name: string) =>
  [...name].map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? "_" : c)).join("").trim().slice(0, 80) || "fluxo";

export function createExchangeService({ automations, workflows, io, appVersion, newToken = randomUUID, ttlMs = 15 * 60_000, now = Date.now }: Deps) {
  /** Conteúdo já validado, esperando confirmação. Só existe no Main; o renderer recebe um token. */
  const pending = new Map<string, { file: ExchangeFile; at: number }>();
  const sweep = () => {
    for (const [k, v] of pending) if (now() - v.at > ttlMs) pending.delete(k);
  };

  return {
    /** Exporta a versão SALVA (não o rascunho): o arquivo é exatamente o que ficou gravado. */
    async exportWorkflow(automationId: string): Promise<ExportResult | null> {
      const automation = automations.list().find((a) => a.id === automationId);
      if (!automation) throw new AppError("NOT_FOUND", "Automação não encontrada. Ela pode ter sido excluída.");
      const { document, version } = workflows.load(automationId);
      if (version === 0) throw new AppError("VALIDATION", "Este fluxo ainda não foi salvo. Salve-o no editor antes de exportar.");
      const path = await io.pickSavePath(`${safeFileName(automation.name)}.automation.json`);
      if (!path) return null;
      try {
        io.writeText(path, buildExport({ name: automation.name, description: automation.description, workflow: document, appVersion }));
      } catch {
        throw new AppError("IO_ERROR", "Não foi possível gravar o arquivo. Verifique o local escolhido e as permissões.");
      }
      return { path };
    },

    /** Lê e valida o arquivo. NÃO cria nada e NUNCA executa. */
    async importPreview(): Promise<ImportPreview | null> {
      const path = await io.pickOpenPath();
      if (!path) return null;
      let text: string;
      try {
        if (io.statSize(path) > MAX_IMPORT_BYTES) throw new AppError("VALIDATION", "O arquivo é grande demais para ser um fluxo do Automation Studio.");
        text = io.readText(path);
      } catch (err) {
        if (err instanceof AppError) throw err;
        throw new AppError("IO_ERROR", "Não foi possível ler o arquivo. Verifique se ele existe e se você tem permissão.");
      }
      const parsed = parseExchange(text);
      if (!parsed.ok) throw new AppError("VALIDATION", parsed.message);
      const { file } = parsed;
      const doc = file.workflow;

      const counts = new Map<string, number>();
      let windowsOnly = false;
      for (const n of doc.nodes) {
        const def = getNodeDefinition(n.type);
        const label = def?.label ?? `Desconhecido (${n.type})`;
        counts.set(label, (counts.get(label) ?? 0) + 1);
        if (def && WINDOWS_CATEGORIES.has(def.category)) windowsOnly = true;
      }
      const issues = validateWorkflow(doc);
      const errors = issues.filter((i) => i.severity === "error");

      sweep();
      const token = newToken();
      pending.clear(); // uma importação pendente por vez
      pending.set(token, { file, at: now() });
      return {
        token,
        fileName: io.baseName(path),
        name: file.automation.name.trim().slice(0, 100) || doc.name.trim().slice(0, 100) || "Fluxo importado",
        description: file.automation.description,
        exportedAt: file.exportedAt,
        appVersion: file.appVersion,
        nodeCount: doc.nodes.length,
        edgeCount: doc.edges.length,
        variableCount: Object.keys(doc.variables).length,
        nodes: [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, "pt-BR")),
        errorPolicy: doc.settings.errorPolicy,
        timeoutSeconds: doc.settings.timeoutSeconds,
        issues: { errors: errors.length, warnings: issues.length - errors.length, first: issues.slice(0, 5).map((i) => i.message) },
        windowsOnly,
      };
    },

    /** Cria a automação com o fluxo como versão 1, com NOVO id. Não executa nada. */
    importConfirm(token: string, name?: string): Automation {
      sweep();
      const entry = pending.get(token);
      if (!entry) throw new AppError("NOT_FOUND", "A importação expirou ou já foi concluída. Escolha o arquivo novamente.");
      const { file } = entry;
      const automation = automations.create({
        name: (name ?? file.automation.name.trim().slice(0, 100)) || file.workflow.name.trim().slice(0, 100) || "Fluxo importado",
        description: file.automation.description.slice(0, 500),
      });
      try {
        workflows.save(automation.id, { ...file.workflow, id: automation.id, name: automation.name });
      } catch (err) {
        automations.remove(automation.id); // nunca deixa automação pela metade
        throw err;
      }
      pending.delete(token);
      return automations.list().find((a) => a.id === automation.id) ?? automation;
    },
  };
}
export type ExchangeService = ReturnType<typeof createExchangeService>;
