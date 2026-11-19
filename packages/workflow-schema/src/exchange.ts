import { z } from "zod";
import { LIMITS, type WorkflowDocument } from "./types.js";
import { parseWorkflowDocument } from "./schema.js";

/** Identifica o arquivo como exportação do Automation Studio (um JSON qualquer não passa). */
export const EXCHANGE_FORMAT = "automation-studio.workflow";
/** Versão do *envelope* (independente do `schemaVersion` do fluxo). Mudou o envelope, suba aqui. */
export const EXCHANGE_VERSION = 1;
/** Tamanho máximo aceito na importação: o fluxo (LIMITS.jsonBytes) + folga do envelope. */
export const MAX_IMPORT_BYTES = LIMITS.jsonBytes + 64 * 1024;

export interface ExchangeFile {
  format: typeof EXCHANGE_FORMAT;
  formatVersion: typeof EXCHANGE_VERSION;
  exportedAt: string;
  appVersion: string;
  automation: { name: string; description: string };
  workflow: WorkflowDocument;
}

const envelopeSchema = z.strictObject({
  format: z.literal(EXCHANGE_FORMAT),
  formatVersion: z.literal(EXCHANGE_VERSION),
  exportedAt: z.string().max(40),
  appVersion: z.string().max(40),
  automation: z.strictObject({ name: z.string().max(200), description: z.string().max(2000) }),
  workflow: z.unknown(),
});

export function buildExport(input: { name: string; description: string; workflow: WorkflowDocument; appVersion: string; now?: Date }): string {
  const file: ExchangeFile = {
    format: EXCHANGE_FORMAT,
    formatVersion: EXCHANGE_VERSION,
    exportedAt: (input.now ?? new Date()).toISOString(),
    appVersion: input.appVersion,
    automation: { name: input.name, description: input.description },
    workflow: input.workflow,
  };
  return JSON.stringify(file, null, 2) + "\n";
}

export type ParseExchangeResult = { ok: true; file: ExchangeFile } | { ok: false; message: string };

/** Valida texto de um arquivo importado. Nunca lança; a mensagem é segura para mostrar ao usuário. */
export function parseExchange(text: string): ParseExchangeResult {
  if (Buffer.byteLength(text) > MAX_IMPORT_BYTES) return { ok: false, message: "O arquivo é grande demais para ser um fluxo do Automation Studio." };
  let raw: unknown;
  try {
    raw = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch {
    return { ok: false, message: "O arquivo não é um JSON válido." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: "O arquivo não parece um fluxo exportado pelo Automation Studio." };
  const head = raw as { format?: unknown; formatVersion?: unknown };
  if (head.format !== EXCHANGE_FORMAT) return { ok: false, message: "O arquivo não parece um fluxo exportado pelo Automation Studio." };
  if (head.formatVersion !== EXCHANGE_VERSION) {
    return { ok: false, message: `Versão de arquivo ${String(head.formatVersion)} não suportada (este app entende a versão ${EXCHANGE_VERSION}). Atualize o aplicativo ou exporte novamente.` };
  }
  const env = envelopeSchema.safeParse(raw);
  if (!env.success) return { ok: false, message: `Arquivo de fluxo inválido: ${env.error.issues[0]?.message ?? "formato desconhecido"}.` };
  const wf = parseWorkflowDocument(env.data.workflow);
  if (!wf.ok) return { ok: false, message: wf.message };
  return { ok: true, file: { ...env.data, format: EXCHANGE_FORMAT, formatVersion: EXCHANGE_VERSION, workflow: wf.doc } };
}
