import { beforeEach, describe, expect, it } from "vitest";
import { IPC, type IpcResult } from "@automation-studio/shared-types";
import { AppError } from "../services/errors.js";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "../services/automations.js";
import { createDiagnostics } from "../services/diagnostics.js";
import { createHistoryService } from "../services/history.js";
import { createExchangeService } from "../services/exchange.js";
import { createExecutionManager } from "../services/executions.js";
import { createTemplatesService } from "../services/templates.js";
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
  const automations = createAutomationService(db);
  const workflows = createWorkflowService(db);
  const history = createHistoryService(db);
  registerIpc(
    { handle: (c, l) => void handlers.set(c, l) },
    {
      automations,
      templates: createTemplatesService({ automations, workflows }),
      settings: createSettingsService(db),
      workflows,
      appInfo: { version: "0.0.0", dataPath: "/x" },
      engine: { status: { state: "unavailable", reason: "teste" } },
      history,
      exchange: createExchangeService({ automations, workflows, appVersion: "0", io: { pickSavePath: async () => null, pickOpenPath: async () => null, statSize: () => 0, readText: () => "", writeText: () => undefined, baseName: (p) => p } }),
      diagnostics: createDiagnostics({ baseDir: "/tmp/as-diag-test", capture: async () => null }),
      executions: createExecutionManager({ engine: { status: { state: "unavailable", reason: "teste" }, executeAction: async () => ({ kind: "cancelled" }), cancel: () => undefined }, emit: () => undefined, history, workflows }),
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
    ["exportar sem id", IPC.exchangeExport, [{}]],
    ["exportar com caminho (renderer não escolhe caminho)", IPC.exchangeExport, [{ automationId: "a", path: "/etc/passwd" }]],
    ["confirmar sem token", IPC.exchangeImportConfirm, [{}]],
    ["importar com caminho (renderer não escolhe caminho)", IPC.exchangeImportPreview, [{ path: "/etc/passwd" }]],
    ["tema inválido", IPC.settingsUpdate, [{ theme: "roxo" }]],
    ["captura não booleana", IPC.settingsUpdate, [{ captureDiagnostics: "sim" }]],
    ["execução sem automação", IPC.executionsStart, [{ document: {} }]],
    ["opções de execução com campo extra", IPC.executionsStart, [{ automationId: "a", document: {}, options: { shell: "rm" } }]],
    ["breakpoints sem lista", IPC.executionsBreakpoints, [{ executionId: "e" }]],
    ["histórico: status inválido", IPC.historyList, [{ statuses: ["hackeado"] }]],
    ["histórico: limite alto demais", IPC.historyList, [{ limit: 100000 }]],
    ["histórico: data inválida", IPC.historyList, [{ from: "ontem" }]],
    ["histórico: campo extra", IPC.historyGet, [{ executionId: "e", sql: "x" }]],
    ["captura: seq inválido", IPC.historyDiagnostic, [{ executionId: "e", seq: 0 }]],
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
        appInfo: { version: "0", dataPath: "" },
        engine: { status: { state: "starting" } },
        executions: {} as never,
        history: {} as never,
        exchange: {} as never,
        diagnostics: {} as never,
        templates: {} as never,
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

  it("motor e execuções: status, validação de entrada e erros claros", () => {
    expect(call(IPC.engineStatus)).toEqual({ ok: true, data: { state: "unavailable", reason: "teste" } });
    expect(call(IPC.executionsStart, [{}])).toMatchObject({ ok: false, error: { code: "VALIDATION" } }); // sem document
    expect(call(IPC.executionsStart, [{ document: { lixo: 1 } }])).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(call(IPC.executionsStart, [{ document: {}, extra: 1 }])).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(call(IPC.executionsCancel, [{ executionId: "nope" }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(call(IPC.executionsCancel, [{}])).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    // motor indisponível: mensagem com o motivo
    const a = call(IPC.automationsCreate, [{ name: "X" }]);
    const id = a.ok ? a.data.id : "";
    const doc = (call(IPC.workflowsLoad, [{ automationId: id }]) as unknown as { data: { document: unknown } }).data.document;
    const r = call(IPC.executionsStart, [{ automationId: id, document: doc }]);
    expect(r).toMatchObject({ ok: false, error: { code: "ENGINE_UNAVAILABLE" } });
    if (!r.ok) expect(r.error.message).toContain("teste");
  });

  it("exemplos: lista e cria uma automação já com o fluxo salvo", () => {
    const list = call(IPC.templatesList) as unknown as { ok: true; data: { id: string; name: string }[] };
    expect(list.ok && list.data.length).toBeGreaterThanOrEqual(4);
    const id = list.data.find((t) => t.id === "organizar-pdfs")!.id;
    const created = call(IPC.templatesCreate, [{ templateId: id, name: "Meus PDFs" }]);
    expect(created).toMatchObject({ ok: true, data: { name: "Meus PDFs", status: "active" } });
    const automationId = created.ok ? created.data.id : "";
    const loaded = call(IPC.workflowsLoad, [{ automationId }]) as unknown as { data: { version: number; document: { id: string; name: string; nodes: unknown[] } } };
    expect(loaded.data.version).toBe(1);
    expect(loaded.data.document).toMatchObject({ id: automationId, name: "Meus PDFs" });
    expect(loaded.data.document.nodes.length).toBeGreaterThan(2);
    expect(call(IPC.templatesCreate, [{ templateId: "nao-existe" }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(call(IPC.templatesCreate, [{ templateId: id, name: "" }])).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
    expect(call(IPC.templatesCreate, [{}])).toMatchObject({ ok: false, error: { code: "VALIDATION" } });
  });

  it("settings e info", () => {
    expect(call(IPC.settingsGet)).toEqual({ ok: true, data: { theme: "system", captureDiagnostics: false } }); // captura desligada por padrão
    expect(call(IPC.settingsUpdate, [{ theme: "dark" }])).toEqual({ ok: true, data: { theme: "dark", captureDiagnostics: false } });
    expect(call(IPC.settingsUpdate, [{ captureDiagnostics: true }])).toEqual({ ok: true, data: { theme: "dark", captureDiagnostics: true } });
    expect(call(IPC.settingsGet)).toEqual({ ok: true, data: { theme: "dark", captureDiagnostics: true } });
    expect(call(IPC.appInfo)).toMatchObject({ ok: true, data: { version: "0.0.0" } });
  });

  it("histórico: lista vazia, execução inexistente e captura inexistente → NOT_FOUND", () => {
    expect(call(IPC.historyList, [{}])).toMatchObject({ ok: true, data: { items: [], total: 0 } });
    expect(call(IPC.historyStats, [{}])).toMatchObject({ ok: true, data: { total: 0 } });
    expect(call(IPC.historyGet, [{ executionId: "nope" }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(call(IPC.historyDiagnostic, [{ executionId: "nope", seq: 1 }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(call(IPC.historyClear, [{}])).toMatchObject({ ok: true, data: { deleted: 0 } });
  });

  it("controles de execução sobre id desconhecido → NOT_FOUND", () => {
    for (const ch of [IPC.executionsPause, IPC.executionsResume, IPC.executionsStep, IPC.executionsCancel]) {
      expect(call(ch, [{ executionId: "x" }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    }
    expect(call(IPC.executionsBreakpoints, [{ executionId: "x", nodeIds: [] }])).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
  });

  it("handlers assíncronos (diálogos) respondem { ok, data | error }, nunca uma Promise dentro de data", async () => {
    const ok = call(IPC.exchangeImportPreview) as unknown as Promise<unknown>;
    expect(ok).toBeInstanceOf(Promise);
    expect(await ok).toEqual({ ok: true, data: null }); // diálogo cancelado
    handlers.clear();
    registerIpc(
      { handle: (c, l) => void handlers.set(c, l) },
      {
        automations: {} as never, settings: {} as never, workflows: {} as never, appInfo: { version: "0", dataPath: "" }, engine: { status: { state: "starting" } },
        executions: {} as never, history: {} as never, diagnostics: {} as never, templates: {} as never,
        exchange: {
          importPreview: async () => {
            throw new AppError("VALIDATION", "arquivo ruim");
          },
          exportWorkflow: async () => {
            throw new Error("disco /segredo falhou");
          },
        } as never,
        isTrustedUrl: () => true,
        onError: (e) => errors.push(e),
      },
    );
    expect(await (call(IPC.exchangeImportPreview) as unknown as Promise<unknown>)).toEqual({ ok: false, error: { code: "VALIDATION", message: "arquivo ruim" } });
    const r = await (call(IPC.exchangeExport, [{ automationId: "a" }]) as unknown as Promise<unknown>);
    expect(r).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(JSON.stringify(r)).not.toContain("segredo");
    expect(errors).toHaveLength(1);
  });
});
