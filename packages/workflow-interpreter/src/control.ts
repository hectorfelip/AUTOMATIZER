/** Regras dos nós de controle executados pelo próprio interpretador (nunca vão ao motor). */

const NUMERIC = /^\s*-?\d+(\.\d+)?\s*$/;
const isNum = (s: string): boolean => NUMERIC.test(s);

export const OPERATOR_LABELS: Record<string, string> = {
  equals: "é igual a",
  not_equals: "é diferente de",
  greater: "é maior que",
  less: "é menor que",
  contains: "contém",
};

export type Condition = { ok: true; value: boolean } | { ok: false; message: string };

/**
 * Compara dois valores. Se ambos forem numéricos, compara como número ("10" > "9"); senão como texto.
 * "maior/menor que" exigem números: comparar texto por ordem alfabética aqui seria uma armadilha.
 */
export function evaluateCondition(left: string, operator: string, right: string): Condition {
  const bothNumeric = isNum(left) && isNum(right);
  switch (operator) {
    case "equals":
      return { ok: true, value: bothNumeric ? Number(left) === Number(right) : left === right };
    case "not_equals":
      return { ok: true, value: bothNumeric ? Number(left) !== Number(right) : left !== right };
    case "contains":
      return { ok: true, value: left.includes(right) };
    case "greater":
    case "less":
      if (!bothNumeric) return { ok: false, message: `“${OPERATOR_LABELS[operator]}” exige números, mas recebeu “${left}” e “${right}”.` };
      return { ok: true, value: operator === "greater" ? Number(left) > Number(right) : Number(left) < Number(right) };
    default:
      return { ok: false, message: `Operador desconhecido: ${operator}.` };
  }
}

export type Coerced = { ok: true; value: string | number | boolean } | { ok: false; message: string };

/** Ajusta o valor atribuído ao tipo com que a variável foi declarada (se foi). */
export function coerceToDeclared(name: string, value: string | number | boolean, type: "string" | "number" | "boolean" | undefined): Coerced {
  if (type === undefined) return { ok: true, value };
  if (type === "string") return { ok: true, value: String(value) };
  if (type === "number") {
    const n = typeof value === "number" ? value : isNum(String(value)) ? Number(value) : NaN;
    return Number.isFinite(n) ? { ok: true, value: n } : { ok: false, message: `A variável “${name}” é um número, mas o valor “${String(value)}” não é numérico.` };
  }
  if (typeof value === "boolean") return { ok: true, value };
  if (value === "true" || value === "false") return { ok: true, value: value === "true" };
  return { ok: false, message: `A variável “${name}” é lógica (verdadeiro/falso), mas o valor “${String(value)}” não é.` };
}
