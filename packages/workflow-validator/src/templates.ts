const REF = /\{\{([^{}]*)\}\}/g;
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const NODE_ID = /^[A-Za-z0-9_-]+$/;
const INDEX = /^\d+$/;
/** Nomes que, num caminho, dariam acesso a internals do JavaScript. Nunca são válidos. */
const FORBIDDEN = new Set(["__proto__", "constructor", "prototype"]);

/** Uma referência dentro de `{{ }}`. Nada é avaliado: é só um caminho de leitura. */
export type Ref =
  | { kind: "variables"; name: string; raw: string }
  | { kind: "nodes"; nodeId: string; key: string; path: string[]; raw: string }
  | { kind: "loop"; name: string; path: string[]; raw: string };

export interface TemplateScan {
  refs: Ref[];
  /** Problemas de sintaxe/expressão não suportada. */
  errors: string[];
  /** Quando o texto é *só* uma referência (preserva o tipo do valor). */
  whole: Ref | null;
}

export const hasTemplate = (text: string): boolean => text.includes("{{") || text.includes("}}");

const SUPPORTED = "Use {{variables.nome}}, {{nodes.id.resultado}} ou {{item.propriedade}}.";

function parseRef(expr: string): Ref | string {
  const bad = `Expressão não suportada: {{${expr}}}. ${SUPPORTED}`;
  const seg = expr.split(".");
  if (seg.some((s) => s === "")) return bad;
  if (seg.some((s) => FORBIDDEN.has(s))) return `Expressão não permitida: {{${expr}}}.`;
  const [head, ...rest] = seg as [string, ...string[]];

  if (head === "variables") {
    if (rest.length !== 1 || !IDENT.test(rest[0]!)) return `Expressão não suportada: {{${expr}}}. Para variáveis, use {{variables.nome}}.`;
    return { kind: "variables", name: rest[0]!, raw: expr };
  }
  if (head === "nodes") {
    const [nodeId, key, ...path] = rest;
    if (!nodeId || !key || !NODE_ID.test(nodeId) || !IDENT.test(key) || !path.every((p) => IDENT.test(p) || INDEX.test(p))) {
      return `Expressão não suportada: {{${expr}}}. Para resultados de nós, use {{nodes.id.resultado}}.`;
    }
    return { kind: "nodes", nodeId, key, path, raw: expr };
  }
  if (!IDENT.test(head) || !rest.every((p) => IDENT.test(p) || INDEX.test(p))) return bad;
  return { kind: "loop", name: head, path: rest, raw: expr };
}

/**
 * Lê as referências `{{...}}` de um texto. Três formas: `variables.x`, `nodes.<id>.<resultado>[.caminho]` e
 * `<item>[.caminho]` (variável de "Para cada item"). Qualquer outra coisa é rejeitada (ARCHITECTURE.md §5: sem eval).
 */
export function scanTemplate(text: string): TemplateScan {
  const refs: Ref[] = [];
  const errors: string[] = [];
  for (const m of text.matchAll(REF)) {
    const parsed = parseRef((m[1] ?? "").trim());
    if (typeof parsed === "string") errors.push(parsed);
    else refs.push(parsed);
  }
  if (hasTemplate(text.replace(REF, ""))) errors.push("Chaves {{ }} não balanceadas.");
  const whole = errors.length === 0 && refs.length === 1 && text.trim().replace(REF, "") === "" ? refs[0]! : null;
  return { refs, errors, whole };
}
