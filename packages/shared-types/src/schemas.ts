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
export const settingsPatchSchema = z.strictObject({ theme: z.enum(THEMES) }).partial();
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
