import { beforeEach, describe, expect, it } from "vitest";
import { IPC, type IpcResult } from "@automation-studio/shared-types";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "../services/automations.js";
import { createSettingsService } from "../services/settings.js";
import { createWorkflowService } from "../services/workflows.js";
import { registerIpc, type IpcMainLike } from "./register.js";

type Listener = Parameters<IpcMainLike["handle"]>[1];
const TRUSTED = "file:///app/index.html";

let handlers: Map<string, Listener>;
let errors: unknown[];
const call = (channel: string, args: unknown[] = [], url = TRUSTED) =>
  handlers.get(channel)!({ senderFrame: { url } }, ...args) as IpcResult<{ id: string }>;

beforeEach(() => {
  handlers = new Map();
  errors = [];
  const db = openDatabase(":memory:");
  registerIpc(
    { handle: (c, l) => void handlers.set(c, l) },
    {
      automations: createAutomationService(db),
      settings: createSettingsService(db),
      workflows: createWorkflowService(db),
      appInfo: { version: "0.0.0", dataPath: "/x", engineStatus: "unavailable" },
      isTrustedUrl: (u) => u.startsWith("file://"),
      onError: (e) => errors.push(e),
    },
  );
});

describe("IPC", () => {
  it("registra todos os canais", () => {
    expect([...handlers.keys()].sort()).toEqual(Object.values(IPC).sort());
  });

  it("fluxo CRUD feliz", () => {
    const created = call(IPC.automationsCreate, [{ name: "  Meu fluxo  " }]);
    expect(created).toMatchObject({ ok: true, data: { name: "Meu fluxo", description: "" } });
    const id = created.ok ? created.data.id : "";
    expect(call(IPC.automationsRename, [{ id, name: "Outro" }]).ok).toBe(true);
    expect(call(IPC.automationsArchive, [{ id }])).toMatchObject({ ok: true, data: { status: "archived" } });
    expect(call(IPC.automationsRestore, [{ id }])).toMatchObject({ ok: true, data: { status: "active" } });
    expect(call(IPC.automationsDelete, [{ id }])).toEqual({ ok: true, data: null });
    expect(call(IPC.automationsList)).toEqual({ ok: true, data: [] });
  });

  it.each<[string, string, unknown[], string?]>([
    ["nome vazio", IPC.automationsCreate, [{ name: "   " }], "vazio"],
    ["nome ausente", IPC.automationsCreate, [{}], "obrigatório"],
    ["nome longo", IPC.automationsCreate, [{ name: "x".repeat(101) }], "100"],
    ["campo extra", IPC.automationsCreate, [{ name: "a", admin: true }]],
    ["tipo errado", IPC.automationsCreate, ["texto"]],
    ["sem argumento", IPC.automationsRename, []],
    ["argumento extra", IPC.automationsDelete, [{ id: "a" }, "outro"]],
    ["tema inválido", IPC.settingsUpdate, [{ theme: "roxo" }]],
    ["lista com argumento", IPC.automationsList, ["x"]],
  ])("rejeita entrada inválida: %s", (_n, channel, args, msg) => {
    const r = call(channel, args);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("VALIDATION");
      if (msg) expect(r.error.message).toContain(msg);
    }
  });

  it("rejeita origem não confiável em todos os canais", () => {
    for (const ch of Object.values(IPC)) {
      const r = call(ch, [], "https://evil.example/");
      expect(r).toMatchObject({ ok: false, error: { code: "UNTRUSTED_SENDER" } });
    }
    expect(call(IPC.automationsList, [], "").ok).toBe(false);
  });

  it("id inexistente devolve NOT_FOUND sem vazar detalhes", () => {
    expect(call(IPC.automationsDelete, [{ id: "nope" }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("erro inesperado vira INTERNAL genérico e é logado", () => {
    handlers.clear();
    registerIpc(
      { handle: (c, l) => void handlers.set(c, l) },
      {
        automations: { list: () => { throw new Error("disk /secret/path exploded"); } } as never,
        settings: {} as never,
        workflows: {} as never,
        appInfo: { version: "0", dataPath: "", engineStatus: "unavailable" },
        isTrustedUrl: () => true,
        onError: (e) => errors.push(e),
      },
    );
    const r = call(IPC.automationsList);
    expect(r).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(JSON.stringify(r)).not.toContain("secret");
    expect(errors).toHaveLength(1);
  });

  it("workflows: carrega fluxo inicial, salva e valida entrada", () => {
    const a = call(IPC.automationsCreate, [{ name: "Fluxo" }]);
    const automationId = a.ok ? a.data.id : "";
    const loaded = call(IPC.workflowsLoad, [{ automationId }]);
    expect(loaded).toMatchObject({ ok: true, data: { version: 0, document: { id: automationId, name: "Fluxo" } } });
    const document = loaded.ok ? (loaded.data as unknown as { document: unknown }).document : null;
    expect(call(IPC.workflowsSave, [{ automationId, document }])).toMatchObject({ ok: true, data: { version: 1, unchanged: false } });
    expect(call(IPC.workflowsSave, [{ automationId, document }])).toMatchObject({ ok: true, data: { version: 1, unchanged: true } });
    expect(call(IPC.workflowsSave, [{ automationId, document: { lixo: true } }])).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(call(IPC.workflowsSave, [{ automationId, document, extra: 1 }])).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(call(IPC.workflowsLoad, [{ automationId: "nope" }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(call(IPC.workflowsLoad, [{}])).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("settings e info", () => {
    expect(call(IPC.settingsUpdate, [{ theme: "dark" }])).toEqual({ ok: true, data: { theme: "dark" } });
    expect(call(IPC.settingsGet)).toEqual({ ok: true, data: { theme: "dark" } });
    expect(call(IPC.appInfo)).toMatchObject({ ok: true, data: { engineStatus: "unavailable" } });
  });
});
