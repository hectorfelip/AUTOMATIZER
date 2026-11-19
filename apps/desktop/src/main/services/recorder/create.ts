import type { Automation, RecordedStep } from "@automation-studio/shared-types";
import { hasErrors, validateWorkflow } from "@automation-studio/workflow-validator";
import { AppError } from "../errors.js";
import type { AutomationService } from "../automations.js";
import type { WorkflowService } from "../workflows.js";
import { stepsToDocument } from "./convert.js";

/** Cria a automação a partir dos passos REVISADOS. Valida antes; nunca executa; falha = nada fica pela metade. */
export function createFromRecording(deps: { automations: AutomationService; workflows: WorkflowService }, name: string, steps: RecordedStep[]): Automation {
  const preview = stepsToDocument(steps, "preview", name);
  const errors = validateWorkflow(preview).filter((i) => i.severity === "error");
  if (hasErrors(errors)) {
    throw new AppError("VALIDATION", `A gravação tem ${errors.length} problema(s) e não pôde virar um fluxo: ${errors[0]!.message} Corrija ou remova o passo na revisão.`);
  }
  const automation = deps.automations.create({ name, description: "Criada pelo gravador." });
  try {
    deps.workflows.save(automation.id, stepsToDocument(steps, automation.id, automation.name));
  } catch (err) {
    deps.automations.remove(automation.id);
    throw err;
  }
  return deps.automations.list().find((a) => a.id === automation.id) ?? automation;
}
