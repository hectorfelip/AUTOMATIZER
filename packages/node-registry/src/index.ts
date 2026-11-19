import type { ConfigValue } from "@automation-studio/workflow-schema";
import { NODE_DEFINITIONS } from "./definitions.js";
import type { NodeDefinition } from "./types.js";

export * from "./types.js";
export { CATEGORIES, NODE_DEFINITIONS } from "./definitions.js";

const byType = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]));
/** Nós de plugins instalados e ativos (substituídos por inteiro a cada mudança). Nunca sobrepõem os embutidos. */
let pluginNodes = new Map<string, NodeDefinition>();

export const getNodeDefinition = (type: string): NodeDefinition | undefined => byType.get(type) ?? pluginNodes.get(type);
/** Só os embutidos (usado para validar o que um plugin pode usar). */
export const getBuiltinNodeDefinition = (type: string): NodeDefinition | undefined => byType.get(type);
export const allNodeDefinitions = (): NodeDefinition[] => [...NODE_DEFINITIONS, ...pluginNodes.values()];

export const PLUGIN_TYPE_PREFIX = "plugin.";
/** Define os nós de plugin ativos. Tipos fora do prefixo `plugin.` ou que colidem com embutidos são ignorados. */
export function setPluginNodes(defs: NodeDefinition[]): void {
  pluginNodes = new Map(defs.filter((d) => d.type.startsWith(PLUGIN_TYPE_PREFIX) && !byType.has(d.type)).map((d) => [d.type, d]));
}

/** Config inicial de um nó novo: valores padrão dos campos. */
export function defaultConfig(def: NodeDefinition): Record<string, ConfigValue> {
  const config: Record<string, ConfigValue> = {};
  for (const f of def.fields) if (f.default !== undefined) config[f.key] = f.default;
  return config;
}
