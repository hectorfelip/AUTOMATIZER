import type { FieldKind } from "@automation-studio/node-registry";
import type { ConfigValue, WorkflowDocument } from "@automation-studio/workflow-schema";
import { hasTemplate, scanTemplate } from "@automation-studio/workflow-validator";

export type Variables = Record<string, string | number | boolean>;
export type ResolveResult = { ok: true; config: Record<string, ConfigValue> } | { ok: false; message: string };

const WHOLE = /^\s*\{\{\s*variables\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/;
const ANY = /\{\{\s*variables\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

export const initialVariables = (doc: WorkflowDocument): Variables =>
  Object.fromEntries(Object.entries(doc.variables).map(([k, v]) => [k, v.value]));

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Ajusta o valor resolvido ao tipo do campo de destino (texto sempre texto; número aceita "5"). */
function coerce(value: ConfigValue, kind: FieldKind | undefined): ConfigValue {
  if (kind === "text" || kind === "path") return value === null ? value : String(value);
  if (kind === "number" && typeof value === "string" && NUMERIC.test(value.trim())) return Number(value);
  if (kind === "boolean" && (value === "true" || value === "false")) return value === "true";
  return value;
}

/**
 * Resolve `{{variables.nome}}` na config de um nó. Só substitui valores: nada é avaliado.
 * Uma referência "pura" preserva o tipo da variável e o resultado é ajustado ao tipo do campo (`kinds`).
 */
export function resolveConfig(config: Record<string, ConfigValue>, variables: Variables, kinds: Record<string, FieldKind> = {}): ResolveResult {
  const out: Record<string, ConfigValue> = {};
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string" || !hasTemplate(value)) {
      out[key] = value;
      continue;
    }
    const scan = scanTemplate(value);
    if (scan.errors.length) return { ok: false, message: `“${key}”: ${scan.errors[0]}` };
    const missing = scan.variables.find((n) => !(n in variables));
    if (missing) return { ok: false, message: `“${key}” usa a variável “${missing}”, que não está definida.` };
    const whole = WHOLE.exec(value);
    out[key] = coerce(whole ? variables[whole[1]!]! : value.replace(ANY, (_m, name: string) => String(variables[name])), kinds[key]);
  }
  return { ok: true, config: out };
}
