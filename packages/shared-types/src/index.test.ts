import { describe, expect, it } from "vitest";
import type { ProtocolMessage } from "./index.js";

describe("shared-types", () => {
  it("aceita um envelope de protocolo válido", () => {
    const msg: ProtocolMessage = { type: "ping", requestId: "req-1", payload: {} };
    expect(msg.type).toBe("ping");
  });
});
