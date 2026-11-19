import { z } from "zod";
import { THEMES } from "./ipc.js";

// ---- Schemas de entrada ----
const idSchema = z.string().min(1, "Identificador inválido.").max(100);

export const nameSchema = z
  .string("O nome é obrigatório.")
  .trim()
  .min(1, "O nome não pode ficar vazio.")
  .max(100, "O nome pode ter no máximo 100 caracteres.");

export const createAutomationSchema = z.strictObject({
  name: nameSchema,
  description: z.string().trim().max(500, "A descrição pode ter no máximo 500 caracteres.").default(""),
});
export const renameAutomationSchema = z.strictObject({ id: idSchema, name: nameSchema });
export const automationIdSchema = z.strictObject({ id: idSchema });
export const loadWorkflowSchema = z.strictObject({ automationId: idSchema });
// `document` é validado em profundidade pelo serviço (parseWorkflowDocument), que dá mensagens melhores.
export const saveWorkflowSchema = z.strictObject({ automationId: idSchema, document: z.unknown() });
export const createFromTemplateSchema = z.strictObject({ templateId: idSchema, name: nameSchema.optional() });
const startOptionsSchema = z.strictObject({
  mode: z.enum(["run", "step", "from"]).optional(),
  fromNodeId: idSchema.optional(),
  variables: z.record(z.string().max(64), z.union([z.string().max(10_000), z.number().finite(), z.boolean()])).optional(),
  breakpoints: z.array(idSchema).max(2000).optional(),
});
export const startExecutionSchema = z.strictObject({ automationId: idSchema, document: z.unknown(), options: startOptionsSchema.optional() });
export const setBreakpointsSchema = z.strictObject({ executionId: idSchema, nodeIds: z.array(idSchema).max(2000) });
export const cancelExecutionSchema = z.strictObject({ executionId: idSchema });
export const settingsPatchSchema = z.strictObject({ theme: z.enum(THEMES), captureDiagnostics: z.boolean() }).partial();
const isoDate = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)), "Data inválida.");
export const historyFiltersSchema = z.strictObject({
  automationId: idSchema.optional(),
  statuses: z.array(z.enum(["running", "paused", "completed", "completed_with_warnings", "failed", "cancelled"])).max(6).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});
export const historyGetSchema = z.strictObject({ executionId: idSchema });
export const historyStatsSchema = z.strictObject({ sinceDays: z.number().int().min(1).max(3650).optional() });
export const historyClearSchema = z.strictObject({ olderThanDays: z.number().int().min(0).max(3650).optional() });
export const historyDiagnosticSchema = z.strictObject({ executionId: idSchema, seq: z.number().int().min(1) });
export const noInputSchema = z.undefined();

// Trava de compilação: os tipos de entrada em ipc.ts precisam aceitar o que os schemas aceitam.
import type { AutomationIdInput, CreateAutomationInput, RenameAutomationInput, SettingsPatch } from "./ipc.js";
export type _InputsMatchSchemas = [
  z.input<typeof createAutomationSchema> extends CreateAutomationInput ? true : never,
  CreateAutomationInput extends z.input<typeof createAutomationSchema> ? true : never,
  z.input<typeof renameAutomationSchema> extends RenameAutomationInput ? true : never,
  z.input<typeof automationIdSchema> extends AutomationIdInput ? true : never,
  z.input<typeof settingsPatchSchema> extends SettingsPatch ? true : never,
  SettingsPatch extends z.input<typeof settingsPatchSchema> ? true : never,
];
