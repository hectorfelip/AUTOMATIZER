import { z } from "zod";

/** Mensagens do motor Python → Main (docs/PROTOCOL.md). O Main valida tudo que chega. */

export const ENGINE_PROTOCOL_VERSION = 1;
export const MAX_LINE_BYTES = 1024 * 1024;

const ids = { executionId: z.string(), nodeId: z.string() };
const errorSchema = z.object({ code: z.string(), message: z.string(), details: z.record(z.string(), z.unknown()).optional() });

const envelope = <T extends string, P extends z.ZodType>(type: T, payload: P) =>
  z.object({ type: z.literal(type), requestId: z.string(), eventId: z.number().int().nonnegative(), payload });

export const engineMessageSchema = z.discriminatedUnion("type", [
  envelope(
    "ready",
    z.object({
      engineVersion: z.string(),
      protocolVersion: z.number().int(),
      python: z.string(),
      platform: z.string(),
      actions: z.array(z.string()),
      optionalModules: z.record(z.string(), z.object({ version: z.string().nullable() })),
    }),
  ),
  envelope("pong", z.object({ uptimeMs: z.number(), activeExecutions: z.number() })),
  envelope("action_started", z.object(ids)),
  envelope("action_progress", z.object({ ...ids, percent: z.number().optional(), message: z.string().optional() })),
  envelope(
    "action_completed",
    z.object({ ...ids, status: z.literal("success"), outputs: z.record(z.string(), z.unknown()), next: z.string().optional(), message: z.string().optional() }),
  ),
  envelope("action_failed", z.object({ ...ids, error: errorSchema })),
  envelope("action_cancelled", z.object(ids)),
  envelope("cancel_ack", z.object({ executionId: z.string(), found: z.boolean() })),
  envelope("protocol_error", z.object({ message: z.string() })),
  envelope("bye", z.object({})),
]);

export type EngineMessage = z.infer<typeof engineMessageSchema>;

export interface EngineInfo {
  engineVersion: string;
  python: string;
  platform: string;
  actions: string[];
  optionalModules: Record<string, { version: string | null }>;
}

/** Estado do motor visto pela interface. `unavailable` sempre traz um motivo legível. */
export type EngineStatus =
  | { state: "starting" | "restarting" }
  | ({ state: "ready" } & EngineInfo)
  | { state: "unavailable"; reason: string };
