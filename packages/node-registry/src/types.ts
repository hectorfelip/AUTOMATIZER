import type { ConfigValue, WorkflowDocument } from "@automation-studio/workflow-schema";

export type FieldKind = "text" | "path" | "number" | "boolean" | "select" | "list" | "automation";

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

export type CategoryId = "control" | "data" | "files" | "windows" | "input" | "web" | "plugins";

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
  /** Chaves extras de config com este prefixo (ex.: `arg.`) são parâmetros de texto validados como os demais. */
  dynamicFieldPrefix?: string;
  /** Nó de PLUGIN declarativo (ADR 0014): executa este fluxo interno (só nós embutidos); os campos viram variáveis de mesmo nome. */
  pluginFlow?: WorkflowDocument;
}
