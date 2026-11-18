import type { DatabaseSync } from "node:sqlite";
import type { WorkflowLoadResult, WorkflowSaveResult } from "@automation-studio/shared-types";
import { LIMITS, createEmptyWorkflow, parseWorkflowDocument, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { AppError } from "./errors.js";

interface AutomationRow {
  id: string;
  name: string;
  current_version: number;
  updated_at: string;
}

export function createWorkflowService(db: DatabaseSync, now: () => string = () => new Date().toISOString()) {
  const automation = (id: string): AutomationRow => {
    const row = db.prepare("SELECT id, name, current_version, updated_at FROM automations WHERE id = ?").get(id);
    if (!row) throw new AppError("NOT_FOUND", "Automação não encontrada. Ela pode ter sido excluída.");
    return row as unknown as AutomationRow;
  };

  /** O nome vive na automação (renomear não cria versão); posições de nós que não existem mais são descartadas. */
  const normalize = (doc: WorkflowDocument, a: AutomationRow): WorkflowDocument => {
    const ids = new Set(doc.nodes.map((n) => n.id));
    const positions = Object.fromEntries(Object.entries(doc.visual.positions).filter(([id]) => ids.has(id)));
    return { ...doc, id: a.id, name: a.name, visual: { positions } };
  };

  /** Forma usada para decidir "nada mudou": o nome não conta (vive na automação). */
  const sameContent = (storedJson: string, doc: WorkflowDocument): boolean => {
    try {
      return JSON.stringify({ ...JSON.parse(storedJson), name: "" }) === JSON.stringify({ ...doc, name: "" });
    } catch {
      return false;
    }
  };

  return {
    load(automationId: string): WorkflowLoadResult {
      const a = automation(automationId);
      if (a.current_version === 0) return { document: createEmptyWorkflow(a.id, a.name), version: 0 };

      const row = db
        .prepare("SELECT definition_json FROM workflow_versions WHERE automation_id = ? AND version_number = ?")
        .get(a.id, a.current_version) as { definition_json: string } | undefined;
      const corrupt = (detail: string) =>
        new AppError("INVALID_DATA", `O fluxo salvo não pôde ser lido (${detail}). Os dados originais foram mantidos.`);
      if (!row) throw corrupt("versão não encontrada");

      let raw: unknown;
      try {
        raw = JSON.parse(row.definition_json);
      } catch {
        throw corrupt("JSON inválido");
      }
      const parsed = parseWorkflowDocument(raw);
      if (!parsed.ok) throw corrupt(parsed.message);
      return { document: normalize(parsed.doc, a), version: a.current_version };
    },

    save(automationId: string, input: unknown): WorkflowSaveResult {
      const a = automation(automationId);
      const parsed = parseWorkflowDocument(input);
      if (!parsed.ok) throw new AppError("VALIDATION", parsed.message);
      if (parsed.doc.id !== a.id) throw new AppError("VALIDATION", "O fluxo pertence a outra automação.");

      const doc = normalize(parsed.doc, a);
      const json = JSON.stringify(doc);
      if (Buffer.byteLength(json) > LIMITS.jsonBytes) throw new AppError("VALIDATION", "O fluxo é grande demais para ser salvo.");

      if (a.current_version > 0) {
        const prev = db
          .prepare("SELECT definition_json FROM workflow_versions WHERE automation_id = ? AND version_number = ?")
          .get(a.id, a.current_version) as { definition_json: string } | undefined;
        if (prev && sameContent(prev.definition_json, doc)) return { version: a.current_version, unchanged: true, savedAt: a.updated_at };
      }

      const version = a.current_version + 1;
      const ts = now();
      db.exec("BEGIN");
      try {
        db.prepare("INSERT INTO workflow_versions (automation_id, version_number, definition_json, created_at) VALUES (?, ?, ?, ?)").run(a.id, version, json, ts);
        db.prepare("UPDATE automations SET current_version = ?, updated_at = ? WHERE id = ?").run(version, ts, a.id);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { version, unchanged: false, savedAt: ts };
    },
  };
}
export type WorkflowService = ReturnType<typeof createWorkflowService>;
