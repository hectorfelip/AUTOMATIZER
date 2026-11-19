import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkflow, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "./automations.js";
import { createHistoryService } from "./history.js";
import { createWorkflowService } from "./workflows.js";

let db: ReturnType<typeof openDatabase>;
let autos: ReturnType<typeof createAutomationService>;
let workflows: ReturnType<typeof createWorkflowService>;
let removed: string[];
let a1: string;
let a2: string;
const T = (min: number) => new Date(Date.UTC(2026, 0, 1, 12, min)).toISOString();
const doc = (id: string, name = "Fluxo"): WorkflowDocument => createEmptyWorkflow(id, name);
const make = (over: Parameters<typeof createHistoryService>[1] = {}) => createHistoryService(db, { removeFiles: (p) => removed.push(...p), now: () => T(59), ...over });
let n = 0;
const begin = (h: ReturnType<typeof make>, automationId: string, min: number, over: Partial<Parameters<ReturnType<typeof make>["begin"]>[0]> = {}) => {
  const id = `ex-${++n}`;
  h.begin({ executionId: id, automationId, workflowVersionId: null, document: doc(automationId), mode: "run", startedAt: T(min), ...over });
  return id;
};
const done = (h: ReturnType<typeof make>, id: string, status: "completed" | "failed" | "cancelled" | "completed_with_warnings" = "completed") => h.finish(id, { status, durationMs: 1000, at: T(59) });

beforeEach(() => {
  db = openDatabase(":memory:");
  autos = createAutomationService(db);
  workflows = createWorkflowService(db);
  removed = [];
  n = 0;
  a1 = autos.create({ name: "Um", description: "" }).id;
  a2 = autos.create({ name: "Dois", description: "" }).id;
});

describe("ciclo de uma execução", () => {
  it("começa 'em execução', recebe logs em ordem e termina com resumo e contexto final", () => {
    const h = make();
    const id = begin(h, a1, 0);
    expect(h.get(id).summary).toMatchObject({ status: "running", finishedAt: null, durationMs: null, workflowName: "Fluxo", mode: "run" });
    h.log(id, { level: "info", message: "começou", at: T(1) });
    h.log(id, { level: "warn", message: "aviso", nodeId: "w", details: { code: "X" }, at: T(2) });
    h.log(id, { level: "error", message: "falhou", nodeId: "w", at: T(3) });
    h.finish(id, { status: "failed", durationMs: 2500, error: { code: "PATH_NOT_FOUND", message: "Mover arquivo: não encontrei" }, failedNodeId: "mv", warnings: 2, snapshot: { variables: { a: 1 }, results: [], loops: [] }, at: T(4) });
    const d = h.get(id);
    expect(d.summary).toMatchObject({ status: "failed", durationMs: 2500, errorCode: "PATH_NOT_FOUND", errorMessage: "Mover arquivo: não encontrei", errorNodeId: "mv", warnings: 2, finishedAt: T(4) });
    expect(d.logs.map((l) => [l.seq, l.level, l.message, l.nodeId])).toEqual([[1, "info", "começou", null], [2, "warn", "aviso", "w"], [3, "error", "falhou", "w"]]);
    expect(d.logs[1]!.details).toEqual({ code: "X" });
    expect(d.snapshot).toEqual({ variables: { a: 1 }, results: [], loops: [] });
  });

  it("guarda uma cópia exata do fluxo executado e o vínculo com a versão, quando houver", () => {
    const h = make();
    const original = workflows.load(a1).document;
    workflows.save(a1, original);
    const versionId = (db.prepare("SELECT id FROM workflow_versions WHERE automation_id = ?").get(a1) as { id: number }).id;
    const linked = begin(h, a1, 0, { document: original, workflowVersionId: versionId });
    const draft = begin(h, a1, 1, { document: { ...original, variables: { x: { type: "string", value: "rascunho" } } } });
    expect(h.get(linked).summary.versionNumber).toBe(1);
    expect(h.get(draft).summary.versionNumber).toBeNull(); // rascunho que nunca foi uma versão
    expect(h.get(linked).document).toEqual(original);
    expect(h.get(draft).document.variables["x"]).toEqual({ type: "string", value: "rascunho" });
  });

  it("id repetido é recusado; execução desconhecida → NOT_FOUND; log de execução encerrada é ignorado", () => {
    const h = make();
    const id = begin(h, a1, 0);
    expect(() => h.begin({ executionId: id, automationId: a1, workflowVersionId: null, document: doc(a1), mode: "run" })).toThrow();
    expect(() => h.get("nao-existe")).toThrow(/não encontrada/);
    done(h, id);
    h.log(id, { level: "info", message: "tarde demais" });
    expect(h.get(id).logs).toHaveLength(0);
  });

  it("pausada/retomada muda o estado; terminar fecha", () => {
    const h = make();
    const id = begin(h, a1, 0);
    h.setStatus(id, "paused");
    expect(h.get(id).summary.status).toBe("paused");
    h.setStatus(id, "running");
    done(h, id, "cancelled");
    h.setStatus(id, "paused"); // não "reabre" uma execução terminada
    expect(h.get(id).summary.status).toBe("cancelled");
  });
});

describe("limite de logs", () => {
  it("acima do limite só os erros são gravados, e o fim avisa quantos foram omitidos", () => {
    const h = make({ maxLogsPerExecution: 3 });
    const id = begin(h, a1, 0);
    for (let i = 1; i <= 10; i++) h.log(id, { level: "info", message: `info ${i}` });
    h.log(id, { level: "error", message: "ERRO IMPORTANTE" });
    h.log(id, { level: "info", message: "mais uma" });
    h.finish(id, { status: "failed", durationMs: 1, at: T(5) });
    const msgs = h.get(id).logs.map((l) => l.message);
    expect(msgs.slice(0, 3)).toEqual(["info 1", "info 2", "info 3"]);
    expect(msgs).toContain("ERRO IMPORTANTE"); // erro nunca se perde
    expect(msgs.at(-1)).toMatch(/8 evento\(s\) de log foram omitidos/);
    expect(msgs).not.toContain("info 10");
  });

  it("mensagens e detalhes enormes são limitados", () => {
    const h = make();
    const id = begin(h, a1, 0);
    h.log(id, { level: "info", message: "x".repeat(10_000), details: { blob: "y".repeat(50_000) } });
    const l = h.get(id).logs[0]!;
    expect(l.message.length).toBe(2000);
    expect(l.details).toEqual({ truncado: true });
  });
});

describe("listar e filtrar", () => {
  beforeEach(() => {
    const h = make();
    done(h, begin(h, a1, 0), "completed");
    done(h, begin(h, a1, 10), "failed");
    done(h, begin(h, a2, 20), "cancelled");
    done(h, begin(h, a2, 30), "completed_with_warnings");
    begin(h, a1, 40); // em execução
  });

  it("mais recentes primeiro, com total", () => {
    const r = make().list();
    expect(r.total).toBe(5);
    expect(r.items.map((i) => i.id)).toEqual(["ex-5", "ex-4", "ex-3", "ex-2", "ex-1"]);
  });
  it("por automação, por estado (vários) e por período", () => {
    const h = make();
    expect(h.list({ automationId: a2 }).items.map((i) => i.id)).toEqual(["ex-4", "ex-3"]);
    expect(h.list({ statuses: ["failed", "cancelled"] }).items.map((i) => i.id)).toEqual(["ex-3", "ex-2"]);
    expect(h.list({ from: T(10), to: T(30) }).items.map((i) => i.id)).toEqual(["ex-4", "ex-3", "ex-2"]); // inclusivo
    expect(h.list({ automationId: a1, statuses: ["completed"], from: T(5) }).total).toBe(0);
    expect(h.list({ statuses: ["running"] }).items.map((i) => i.id)).toEqual(["ex-5"]);
  });
  it("paginação", () => {
    const h = make();
    const p1 = h.list({ limit: 2, offset: 0 });
    const p2 = h.list({ limit: 2, offset: 2 });
    expect(p1.total).toBe(5);
    expect([...p1.items, ...p2.items].map((i) => i.id)).toEqual(["ex-5", "ex-4", "ex-3", "ex-2"]);
    expect(h.list({ limit: 1000 }).items).toHaveLength(5); // limite máximo aplicado
  });
  it("estatísticas só contam execuções terminadas", () => {
    expect(make().stats()).toEqual({ total: 4, completed: 1, completedWithWarnings: 1, failed: 1, cancelled: 1 });
    expect(make().stats(T(15))).toEqual({ total: 2, completed: 0, completedWithWarnings: 1, failed: 0, cancelled: 1 });
  });
});

describe("recuperação após fechamento inesperado", () => {
  it("execução que ficou 'em execução' ou 'pausada' vira falha 'APP_CLOSED'; as terminadas não mudam", () => {
    const h = make();
    const running = begin(h, a1, 0);
    const paused = begin(h, a1, 1);
    h.setStatus(paused, "paused");
    const ok = begin(h, a1, 2);
    done(h, ok);
    expect(make({ now: () => T(30) }).recoverInterrupted()).toBe(2);
    for (const id of [running, paused]) {
      const d = h.get(id);
      expect(d.summary).toMatchObject({ status: "failed", errorCode: "APP_CLOSED", errorMessage: "O aplicativo foi fechado durante a execução." });
      expect(d.summary.durationMs).toBeGreaterThan(0);
      expect(d.logs.at(-1)).toMatchObject({ level: "error", message: "O aplicativo foi fechado durante a execução." });
    }
    expect(h.get(ok).summary.status).toBe("completed");
    expect(make().recoverInterrupted()).toBe(0); // idempotente
  });
});

describe("limpeza e limites", () => {
  it("'limpar tudo' apaga o terminado, mantém o em andamento e remove os arquivos de diagnóstico", () => {
    const h = make();
    const a = begin(h, a1, 0);
    h.log(a, { level: "error", message: "x", diagnosticPath: "/diag/a.png" });
    done(h, a, "failed");
    const b = begin(h, a1, 1);
    h.log(b, { level: "error", message: "y", diagnosticPath: "/diag/b.png" });
    done(h, b, "failed");
    const live = begin(h, a1, 2);
    h.log(live, { level: "error", message: "z", diagnosticPath: "/diag/live.png" });
    expect(h.clear()).toEqual({ deleted: 2 });
    expect(removed.sort()).toEqual(["/diag/a.png", "/diag/b.png"]);
    expect(h.list().items.map((i) => i.id)).toEqual([live]);
    expect(h.get(live).logs).toHaveLength(1);
  });

  it("'mais antigas que N dias'", () => {
    const old = new Date(Date.UTC(2026, 0, 1)).toISOString();
    const recent = new Date(Date.UTC(2026, 0, 28)).toISOString();
    const h = make({ now: () => new Date(Date.UTC(2026, 0, 31)).toISOString() });
    done(h, begin(h, a1, 0, { startedAt: old }));
    done(h, begin(h, a1, 0, { startedAt: recent }));
    expect(h.clear({ olderThanDays: 7 })).toEqual({ deleted: 1 });
    expect(h.list().items.map((i) => i.startedAt)).toEqual([recent]);
  });

  it("mantém só as N execuções mais recentes (as antigas saem com seus logs e arquivos)", () => {
    const h = make({ maxExecutions: 3 });
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = begin(h, a1, i);
      h.log(id, { level: "error", message: "e", diagnosticPath: `/diag/${i}.png` });
      done(h, id);
      ids.push(id);
    }
    expect(h.list().items.map((i) => i.id)).toEqual([ids[4], ids[3], ids[2]]);
    expect(removed.sort()).toEqual(["/diag/0.png", "/diag/1.png"]);
    expect((db.prepare("SELECT COUNT(*) AS n FROM execution_logs").get() as { n: number }).n).toBe(3); // sem logs órfãos
  });

  it("excluir a automação leva o histórico junto (cascata); diagnosticPathsOf diz quais arquivos apagar", () => {
    const h = make();
    const id = begin(h, a1, 0);
    h.log(id, { level: "error", message: "x", diagnosticPath: "/diag/x.png" });
    done(h, id);
    expect(h.diagnosticPathsOf(a1)).toEqual(["/diag/x.png"]); // coletados ANTES de excluir (as linhas somem em cascata)
    expect(h.diagnosticPathsOf(a2)).toEqual([]);
    autos.remove(a1);
    expect(h.list().total).toBe(0);
    expect((db.prepare("SELECT COUNT(*) AS n FROM execution_logs").get() as { n: number }).n).toBe(0);
  });

  it("diagnosticPath só devolve o arquivo da execução e do log pedidos", () => {
    const h = make();
    const id = begin(h, a1, 0);
    h.log(id, { level: "error", message: "x", diagnosticPath: "/diag/x.png" });
    h.log(id, { level: "info", message: "sem captura" });
    expect(h.diagnosticPath(id, 1)).toBe("/diag/x.png");
    expect(h.diagnosticPath(id, 2)).toBeNull();
    expect(h.diagnosticPath("outra", 1)).toBeNull();
    expect(h.get(id).logs.map((l) => l.hasDiagnostic)).toEqual([true, false]);
  });
});
