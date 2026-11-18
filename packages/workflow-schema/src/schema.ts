import { z } from "zod";
import { LIMITS, VARIABLE_NAME_PATTERN, WORKFLOW_SCHEMA_VERSION, type WorkflowDocument } from "./types.js";

const id = z.string().min(1).max(100);
const handle = z.string().min(1).max(50);
const configValue = z.union([z.string().max(10_000), z.number().finite(), z.boolean(), z.null()]);
const coord = z.number().finite().min(-1_000_000).max(1_000_000);

const nodeSchema = z.strictObject({
  id,
  type: z.string().min(1).max(100),
  version: z.number().int().min(1),
  config: z.record(z.string().max(100), configValue),
});

const edgeSchema = z.strictObject({
  id,
  source: id,
  sourceHandle: handle,
  target: id,
  targetHandle: handle,
});

const variableSchema = z.strictObject({
  type: z.enum(["string", "number", "boolean"]),
  value: z.union([z.string().max(10_000), z.number().finite(), z.boolean()]),
});

export const workflowDocumentSchema = z.strictObject({
  schemaVersion: z.literal(WORKFLOW_SCHEMA_VERSION),
  id,
  name: z.string().max(200),
  nodes: z.array(nodeSchema).max(LIMITS.nodes),
  edges: z.array(edgeSchema).max(LIMITS.edges),
  variables: z
    .record(z.string().regex(VARIABLE_NAME_PATTERN, "Nome de variável inválido."), variableSchema)
    .refine((v) => Object.keys(v).length <= LIMITS.variables, "Variáveis demais."),
  settings: z.strictObject({
    timeoutSeconds: z.number().int().min(1).max(86_400),
    errorPolicy: z.enum(["stop", "continue"]),
  }),
  visual: z.strictObject({ positions: z.record(id, z.strictObject({ x: coord, y: coord })) }),
});

export type ParseResult = { ok: true; doc: WorkflowDocument } | { ok: false; message: string };

/** Valida a *forma* do documento (não o significado: isso é do workflow-validator). */
export function parseWorkflowDocument(input: unknown): ParseResult {
  const version = (input as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (typeof version === "number" && version !== WORKFLOW_SCHEMA_VERSION) {
    return {
      ok: false,
      message: `Versão de schema ${version} não suportada (este app entende a versão ${WORKFLOW_SCHEMA_VERSION}).`,
    };
  }
  const res = workflowDocumentSchema.safeParse(input);
  if (res.success) return { ok: true, doc: res.data };
  const issue = res.error.issues[0];
  const where = issue?.path.length ? ` (em ${issue.path.join(".")})` : "";
  return { ok: false, message: `Documento de fluxo inválido: ${issue?.message ?? "formato desconhecido"}${where}.` };
}
