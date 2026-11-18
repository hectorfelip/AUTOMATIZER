/** Envelope de mensagem do protocolo JSON Lines Node↔Python (ARCHITECTURE.md §8). */
export interface ProtocolMessage<T = unknown> {
  type: string;
  requestId: string;
  payload: T;
}
