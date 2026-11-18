import type { ConfigValue } from "@automation-studio/workflow-schema";

export type FieldKind = "text" | "path" | "number" | "boolean" | "select";

/** Parâmetro configurável de um nó. A UI (painel de propriedades) e o validador derivam disto. */
export interface ConfigField {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  default?: ConfigValue;
  options?: { value: string; label: string }[];
  min?: number;
  max?: number;
  placeholder?: string;
  help?: string;
  /** Regex (fonte) que valores literais devem respeitar. */
  pattern?: string;
  patternMessage?: string;
}

export interface Port {
  id: string;
  label: string;
}

export type CategoryId = "control" | "data" | "files" | "windows" | "input";

export interface NodeDefinition {
  /** Identificador estável, ex.: `files.move`. */
  type: string;
  /** Versão do contrato. */
  version: number;
  label: string;
  category: CategoryId;
  description: string;
  inputs: Port[];
  outputs: Port[];
  fields: ConfigField[];
  /** No máximo uma instância por fluxo (ex.: início). */
  unique?: boolean;
}
