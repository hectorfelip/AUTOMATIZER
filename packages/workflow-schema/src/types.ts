/**
 * Documento de workflow (ARCHITECTURE.md §5).
 * Parâmetros de execução (`nodes`, `edges`, `variables`, `settings`) ficam separados dos dados
 * puramente visuais (`visual`): o interpretador só precisa ler o que não é `visual`.
 */
export const WORKFLOW_SCHEMA_VERSION = 1;

export type ConfigValue = string | number | boolean | null;
export type VariableType = "string" | "number" | "boolean";

export interface WorkflowNode {
  id: string;
  /** Identificador estável do tipo, ex.: `files.move`. */
  type: string;
  /** Versão do contrato do nó. */
  version: number;
  config: Record<string, ConfigValue>;
}

export interface WorkflowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle: string;
}

export interface WorkflowVariable {
  type: VariableType;
  value: string | number | boolean;
}

export interface WorkflowSettings {
  timeoutSeconds: number;
  errorPolicy: "stop" | "continue";
}

export interface WorkflowVisual {
  positions: Record<string, { x: number; y: number }>;
}

export interface WorkflowDocument {
  schemaVersion: typeof WORKFLOW_SCHEMA_VERSION;
  id: string;
  name: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  variables: Record<string, WorkflowVariable>;
  settings: WorkflowSettings;
  visual: WorkflowVisual;
}

export const VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

export const LIMITS = { nodes: 2000, edges: 5000, variables: 200, jsonBytes: 5_000_000 } as const;
