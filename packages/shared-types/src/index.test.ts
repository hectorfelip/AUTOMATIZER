import { describe, expect, it } from "vitest";
import { WORKFLOW_SCHEMA_VERSION, type ProtocolMessage } from "./index.js";

describe("shared-types", () => {
  it("expõe a versão 1 do schema de workflow", () => {
    expect(WORKFLOW_SCHEMA_VERSION).toBe(1);
  });

  it("aceita um envelope de protocolo válido", () => {
    const msg: ProtocolMessage = { type: "ping", requestId: "req-1", payload: {} };
    expect(msg.type).toBe("ping");
  });
});
