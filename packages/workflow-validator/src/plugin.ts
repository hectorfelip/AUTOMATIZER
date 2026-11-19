import { z } from "zod";
import { PLUGIN_TYPE_PREFIX, getBuiltinNodeDefinition, type ConfigField, type NodeDefinition, type ResultDef } from "@automation-studio/node-registry";
import { VARIABLE_NAME_PATTERN, parseWorkflowDocument, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { hasErrors, validateWorkflow } from "./validate.js";

/** Plugin DECLARATIVO (ADR 0014, opção A): define um nó novo por composição de nós embutidos. Nunca traz código. */
export const PLUGIN_FORMAT = "automation-studio.plugin";
export const PLUGIN_FORMAT_VERSION = 1;
export const MAX_PLUGIN_BYTES = 512 * 1024;
const MAX_FLOW_NODES = 200;

const key = z.string().regex(VARIABLE_NAME_PATTERN, "Nome inválido (use letras, números e _).");
const fieldSchema = z.strictObject({
  key,
  label: z.string().min(1).max(60),
  kind: z.enum(["text", "number", "boolean"]),
  required: z.boolean().optional(),
  help: z.string().max(300).optional(),
});
const pluginSchema = z.strictObject({
  format: z.literal(PLUGIN_FORMAT),
  formatVersion: z.literal(PLUGIN_FORMAT_VERSION),
  id: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/, "O id deve ter 2–40 caracteres: letras minúsculas, números e hífen, começando por letra."),
  name: z.string().trim().min(1).max(80),
  version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/, "A versão deve ser no formato 1.0.0."),
  description: z.string().max(500),
  /** Campos do nó: cada um vira a variável de MESMO NOME no fluxo interno (que declara tipo e padrão). */
  fields: z.array(fieldSchema).max(20),
  /** Variáveis do fluxo interno devolvidas como resultados do nó. */
  returns: z.array(key).max(20),
  flow: z.unknown(),
});

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  description: string;
  nodeType: string;
  fieldCount: number;
  returns: string[];
  nodeCount: number;
}
export type ParsePluginResult = { ok: true; info: PluginInfo; node: NodeDefinition } | { ok: false; message: string };

const KIND_OF = { text: "string", number: "number", boolean: "boolean" } as const;
const RESULT_TYPE = { string: "string", number: "number", boolean: "boolean" } as const;

/** Valida o texto de um plugin e produz a definição do nó. Nunca lança; a mensagem é segura para a interface. */
export function parsePlugin(text: string): ParsePluginResult {
  if (new TextEncoder().encode(text).length > MAX_PLUGIN_BYTES) return { ok: false, message: "O arquivo é grande demais para ser um plugin." };
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, message: "O arquivo não é um JSON válido." };
  }
  const head = raw as { format?: unknown; formatVersion?: unknown } | null;
  if (!head || typeof head !== "object" || head.format !== PLUGIN_FORMAT) return { ok: false, message: "O arquivo não parece um plugin do Automation Studio." };
  if (head.formatVersion !== PLUGIN_FORMAT_VERSION) {
    return { ok: false, message: `Versão de plugin ${String(head.formatVersion)} não suportada (este app entende a versão ${PLUGIN_FORMAT_VERSION}).` };
  }
  const p = pluginSchema.safeParse(raw);
  if (!p.success) return { ok: false, message: `Plugin inválido: ${p.error.issues[0]?.message ?? "formato desconhecido"}${p.error.issues[0]?.path.length ? ` (em ${p.error.issues[0].path.join(".")})` : ""}.` };
  const plugin = p.data;

  const parsed = parseWorkflowDocument(plugin.flow);
  if (!parsed.ok) return { ok: false, message: `Fluxo interno inválido: ${parsed.message}` };
  const flow: WorkflowDocument = parsed.doc;
  if (flow.nodes.length > MAX_FLOW_NODES) return { ok: false, message: `O fluxo interno tem nós demais (máximo ${MAX_FLOW_NODES}).` };

  // só nós EMBUTIDOS (nada de plugin chamando plugin nem "Chamar fluxo", que dependeria de outras automações)
  for (const n of flow.nodes) {
    if (n.type === "flow.subflow") return { ok: false, message: "Plugins não podem usar “Chamar fluxo” (dependeriam de outras automações)." };
    if (!getBuiltinNodeDefinition(n.type)) {
      return { ok: false, message: `O fluxo interno usa “${n.type}”, que não é um nó embutido. Plugins só combinam nós embutidos.` };
    }
  }
  const issues = validateWorkflow(flow).filter((i) => i.severity === "error");
  if (hasErrors(issues)) return { ok: false, message: `O fluxo interno tem ${issues.length} erro(s): ${issues[0]!.message}` };

  const seen = new Set<string>();
  for (const f of plugin.fields) {
    if (seen.has(f.key)) return { ok: false, message: `Campo repetido: “${f.key}”.` };
    seen.add(f.key);
    const v = flow.variables[f.key];
    if (!v) return { ok: false, message: `O campo “${f.key}” precisa de uma variável de mesmo nome no fluxo interno (ela define o tipo e o valor padrão).` };
    if (v.type !== KIND_OF[f.kind]) return { ok: false, message: `O campo “${f.key}” é ${f.kind}, mas a variável do fluxo interno é ${v.type}.` };
  }
  const results: ResultDef[] = [];
  for (const r of new Set(plugin.returns)) {
    const v = flow.variables[r];
    if (!v) return { ok: false, message: `O retorno “${r}” não existe como variável no fluxo interno.` };
    results.push({ key: r, label: r, type: RESULT_TYPE[v.type] });
  }
  if (results.some((r) => r.key === "status")) return { ok: false, message: "“status” é reservado; use outro nome de retorno." };
  results.push({ key: "status", label: "Como terminou", type: "string" });

  const fields: ConfigField[] = plugin.fields.map((f) => ({
    key: f.key,
    label: f.label,
    kind: f.kind,
    ...(f.required ? { required: true } : {}),
    ...(flow.variables[f.key]!.value !== "" ? { default: flow.variables[f.key]!.value } : {}),
    ...(f.help ? { help: f.help } : {}),
  }));
  const nodeType = `${PLUGIN_TYPE_PREFIX}${plugin.id}`;
  const node: NodeDefinition = {
    type: nodeType,
    version: 1,
    label: plugin.name,
    category: "plugins",
    description: plugin.description || `Plugin ${plugin.name} ${plugin.version}.`,
    inputs: [{ id: "input", label: "Entrada" }],
    outputs: [
      { id: "success", label: "Sucesso" },
      { id: "error", label: "Erro" },
    ],
    fields,
    results,
    pluginFlow: flow,
  };
  return {
    ok: true,
    node,
    info: { id: plugin.id, name: plugin.name, version: plugin.version, description: plugin.description, nodeType, fieldCount: fields.length, returns: [...new Set(plugin.returns)], nodeCount: flow.nodes.length },
  };
}
