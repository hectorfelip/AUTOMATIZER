import type { ConfigValue } from "@automation-studio/workflow-schema";

export type FieldKind = "text" | "path" | "number" | "boolean" | "select" | "list";

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
  /** Não aceita `{{variables.x}}`: o valor precisa ser fixo (ex.: nome de variável). */
  literal?: boolean;
  /** Regex (fonte) que valores literais devem respeitar. */
  pattern?: string;
  patternMessage?: string;
}

export type ResultType = "string" | "number" | "boolean" | "list" | "object";

/** Resultado que um nó expõe a outros via `{{nodes.<id>.<key>}}` (validado em tempo de desenho). */
export interface ResultDef {
  key: string;
  label: string;
  type: ResultType;
  /** Para listas de objetos: propriedades de cada item (`{{item.<prop>}}`). */
  itemProps?: string[];
}

export interface Port {
  id: string;
  label: string;
}

export type CategoryId = "control" | "data" | "files" | "windows" | "input" | "web";

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
  /** Resultados disponíveis para os nós seguintes. */
  results?: ResultDef[];
  /** No máximo uma instância por fluxo (ex.: início). */
  unique?: boolean;
}
