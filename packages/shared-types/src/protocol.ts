/** Versão atual do schema de workflow (ARCHITECTURE.md §5). */
export const WORKFLOW_SCHEMA_VERSION = 1;

/** Envelope de mensagem do protocolo JSON Lines Node↔Python (ARCHITECTURE.md §8). */
export interface ProtocolMessage<T = unknown> {
  type: string;
  requestId: string;
  payload: T;
}
