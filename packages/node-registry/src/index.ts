import type { ConfigValue } from "@automation-studio/workflow-schema";
import { NODE_DEFINITIONS } from "./definitions.js";
import type { NodeDefinition } from "./types.js";

export * from "./types.js";
export { CATEGORIES, NODE_DEFINITIONS } from "./definitions.js";

const byType = new Map(NODE_DEFINITIONS.map((d) => [d.type, d]));
export const getNodeDefinition = (type: string): NodeDefinition | undefined => byType.get(type);

/** Config inicial de um nó novo: valores padrão dos campos. */
export function defaultConfig(def: NodeDefinition): Record<string, ConfigValue> {
  const config: Record<string, ConfigValue> = {};
  for (const f of def.fields) if (f.default !== undefined) config[f.key] = f.default;
  return config;
}
