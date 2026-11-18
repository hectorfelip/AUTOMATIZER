import { WORKFLOW_SCHEMA_VERSION, type WorkflowDocument } from "./types.js";

/** Fluxo inicial de uma automação nova: só o nó de início. */
export function createEmptyWorkflow(id: string, name: string): WorkflowDocument {
  return {
    schemaVersion: WORKFLOW_SCHEMA_VERSION,
    id,
    name,
    nodes: [{ id: "start", type: "trigger.manual", version: 1, config: {} }],
    edges: [],
    variables: {},
    settings: { timeoutSeconds: 600, errorPolicy: "stop" },
    visual: { positions: { start: { x: 80, y: 120 } } },
  };
}
