export type Severity = "error" | "warning";

export type IssueCode =
  | "DUPLICATE_NODE_ID"
  | "UNKNOWN_NODE_TYPE"
  | "UNSUPPORTED_NODE_VERSION"
  | "NO_START"
  | "DUPLICATE_UNIQUE_NODE"
  | "DUPLICATE_EDGE_ID"
  | "EDGE_UNKNOWN_NODE"
  | "EDGE_UNKNOWN_PORT"
  | "EDGE_SELF_LOOP"
  | "OUTPUT_ALREADY_CONNECTED"
  | "REQUIRED_FIELD"
  | "INVALID_FIELD"
  | "BAD_EXPRESSION"
  | "UNKNOWN_VARIABLE"
  | "INVALID_VARIABLE"
  | "UNREACHABLE_NODE"
  | "CYCLE_NO_EXIT";

export interface Issue {
  severity: Severity;
  code: IssueCode;
  /** Mensagem pronta para o usuário (pt-BR), específica do nó/campo/conexão. */
  message: string;
  nodeId?: string;
  edgeId?: string;
  field?: string;
}
