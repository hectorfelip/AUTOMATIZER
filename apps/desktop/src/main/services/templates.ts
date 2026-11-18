import type { Automation, TemplateInfo } from "@automation-studio/shared-types";
import { parseWorkflowDocument, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { AppError } from "./errors.js";
import type { AutomationService } from "./automations.js";
import type { WorkflowService } from "./workflows.js";

interface TemplateFile {
  meta: TemplateInfo;
  workflow: unknown;
}

// Exemplos prontos vivem em /templates (ARCHITECTURE.md §4), um JSON por exemplo.
const files = import.meta.glob("../../../../../templates/*.json", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

export interface Template extends TemplateInfo {
  workflow: WorkflowDocument;
}

/** Lê e valida todos os exemplos; um exemplo quebrado é erro de build, não de execução. */
export const templates: Template[] = Object.entries(files)
  .map(([path, raw]) => {
    const file = JSON.parse(raw) as TemplateFile;
    const parsed = parseWorkflowDocument(file.workflow);
    if (!parsed.ok) throw new Error(`Exemplo inválido (${path}): ${parsed.message}`);
    return { ...file.meta, workflow: parsed.doc };
  })
  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));

export function createTemplatesService(deps: { automations: AutomationService; workflows: WorkflowService }) {
  return {
    list: (): TemplateInfo[] => templates.map(({ id, name, description, windowsOnly }) => ({ id, name, description, windowsOnly })),

    /** Cria a automação e já grava o fluxo do exemplo como versão 1. Se algo falhar, não deixa automação pela metade. */
    createAutomation(templateId: string, name?: string): Automation {
      const t = templates.find((x) => x.id === templateId);
      if (!t) throw new AppError("NOT_FOUND", "Exemplo não encontrado.");
      const automation = deps.automations.create({ name: name ?? t.name, description: t.description });
      try {
        deps.workflows.save(automation.id, { ...t.workflow, id: automation.id, name: automation.name });
      } catch (err) {
        deps.automations.remove(automation.id);
        throw err;
      }
      return deps.automations.list().find((a) => a.id === automation.id) ?? automation;
    },
  };
}
export type TemplatesService = ReturnType<typeof createTemplatesService>;
