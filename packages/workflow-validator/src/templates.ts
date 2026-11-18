import { VARIABLE_NAME_PATTERN } from "@automation-studio/workflow-schema";

const REF = /\{\{([^{}]*)\}\}/g;
const VARIABLE_REF = new RegExp(`^variables\\.(${VARIABLE_NAME_PATTERN.source.slice(1, -1)})$`);

export interface TemplateScan {
  /** Nomes de variáveis referenciadas, ex.: `{{variables.x}}` → "x". */
  variables: string[];
  /** Problemas de sintaxe/expressão não suportada. */
  errors: string[];
}

export const hasTemplate = (text: string): boolean => text.includes("{{") || text.includes("}}");

/**
 * Lê as referências `{{...}}` de um texto. Só `variables.<nome>` é suportado: nada é avaliado,
 * expressões arbitrárias são rejeitadas (ARCHITECTURE.md §5: sem eval).
 */
export function scanTemplate(text: string): TemplateScan {
  const variables: string[] = [];
  const errors: string[] = [];
  for (const m of text.matchAll(REF)) {
    const expr = (m[1] ?? "").trim();
    const ref = VARIABLE_REF.exec(expr);
    if (ref) variables.push(ref[1]!);
    else errors.push(`Expressão não suportada: {{${expr}}}. Use {{variables.nome}}.`);
  }
  if (hasTemplate(text.replace(REF, ""))) errors.push("Chaves {{ }} não balanceadas.");
  return { variables, errors };
}
