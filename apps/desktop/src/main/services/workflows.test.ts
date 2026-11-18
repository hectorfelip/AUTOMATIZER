import { beforeEach, describe, expect, it } from "vitest";
import { createEmptyWorkflow, type WorkflowDocument } from "@automation-studio/workflow-schema";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "./automations.js";
import { AppError } from "./errors.js";
import { createWorkflowService } from "./workflows.js";

let db: ReturnType<typeof openDatabase>;
let wf: ReturnType<typeof createWorkflowService>;
let autos: ReturnType<typeof createAutomationService>;
let id: string;

const withWait = (doc: WorkflowDocument): WorkflowDocument => ({
  ...doc,
  nodes: [...doc.nodes, { id: "w", type: "flow.wait", version: 1, config: { seconds: 2 } }],
  edges: [{ id: "e1", source: "start", sourceHandle: "next", target: "w", targetHandle: "input" }],
  visual: { positions: { ...doc.visual.positions, w: { x: 400, y: 120.5 } } },
});
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return "NO_ERROR";
};

beforeEach(() => {
  db = openDatabase(":memory:");
  autos = createAutomationService(db);
  wf = createWorkflowService(db);
  id = autos.create({ name: "Meu fluxo", description: "" }).id;
});

describe("workflow service", () => {
  it("automação nova carrega o fluxo inicial (versão 0) sem gravar nada", () => {
    const r = wf.load(id);
    expect(r.version).toBe(0);
    expect(r.document).toEqual(createEmptyWorkflow(id, "Meu fluxo"));
    expect(db.prepare("SELECT COUNT(*) AS n FROM workflow_versions").get()).toEqual({ n: 0 });
  });

  it("salvar e recarregar preserva nós, conexões e posições", () => {
    const doc = withWait(wf.load(id).document);
    expect(wf.save(id, doc)).toMatchObject({ version: 1, unchanged: false });
    const back = wf.load(id);
    expect(back.version).toBe(1);
    expect(back.document).toEqual(doc);
    expect(back.document.visual.positions["w"]).toEqual({ x: 400, y: 120.5 });
  });

  it("cada alteração cria uma versão imutável; salvar igual não cria", () => {
    const v1 = withWait(wf.load(id).document);
    wf.save(id, v1);
    expect(wf.save(id, v1)).toMatchObject({ version: 1, unchanged: true });
    const v2 = { ...v1, variables: { x: { type: "string" as const, value: "a" } } };
    expect(wf.save(id, v2)).toMatchObject({ version: 2, unchanged: false });
    const rows = db.prepare("SELECT version_number FROM workflow_versions ORDER BY version_number").all();
    expect(rows).toEqual([{ version_number: 1 }, { version_number: 2 }]);
    expect(wf.load(id).document.variables).toHaveProperty("x");
    expect((db.prepare("SELECT current_version FROM automations WHERE id = ?").get(id) as { current_version: number }).current_version).toBe(2);
  });

  it("só mover um nó já conta como alteração (posição é salva)", () => {
    const v1 = withWait(wf.load(id).document);
    wf.save(id, v1);
    const moved = { ...v1, visual: { positions: { ...v1.visual.positions, w: { x: 500, y: 200 } } } };
    expect(wf.save(id, moved).version).toBe(2);
  });

  it("o nome vem da automação: renomear não exige nova versão e o fluxo reflete o nome atual", () => {
    wf.save(id, withWait(wf.load(id).document));
    autos.rename(id, "Novo nome");
    expect(wf.load(id).document.name).toBe("Novo nome");
    const doc = { ...wf.load(id).document, name: "Nome forjado" };
    expect(wf.save(id, doc)).toMatchObject({ unchanged: true });
  });

  it("descarta posições de nós que não existem mais", () => {
    const doc = withWait(wf.load(id).document);
    doc.visual.positions["fantasma"] = { x: 1, y: 1 };
    wf.save(id, doc);
    expect(Object.keys(wf.load(id).document.visual.positions).sort()).toEqual(["start", "w"]);
  });

  it("permite salvar rascunho semanticamente inválido (validação é para executar)", () => {
    const doc = wf.load(id).document;
    doc.nodes.push({ id: "mv", type: "files.move", version: 1, config: {} });
    expect(wf.save(id, doc).version).toBe(1);
  });

  it("rejeita documento malformado, de outra automação ou de schema futuro", () => {
    const doc = wf.load(id).document;
    expect(code(() => wf.save(id, { lixo: 1 }))).toBe("VALIDATION");
    expect(code(() => wf.save(id, { ...doc, id: "outra" }))).toBe("VALIDATION");
    expect(code(() => wf.save(id, { ...doc, schemaVersion: 2 }))).toBe("VALIDATION");
    expect(db.prepare("SELECT COUNT(*) AS n FROM workflow_versions").get()).toEqual({ n: 0 });
  });

  it("automação inexistente → NOT_FOUND", () => {
    expect(code(() => wf.load("x"))).toBe("NOT_FOUND");
    expect(code(() => wf.save("x", {}))).toBe("NOT_FOUND");
  });

  it("dados corrompidos no banco dão erro claro sem apagar nada", () => {
    wf.save(id, withWait(wf.load(id).document));
    db.prepare("UPDATE workflow_versions SET definition_json = '{quebrado'").run();
    expect(code(() => wf.load(id))).toBe("INVALID_DATA");
    db.prepare("UPDATE workflow_versions SET definition_json = '{\"schemaVersion\":9}'").run();
    expect(() => wf.load(id)).toThrow(/não suportada/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM workflow_versions").get()).toEqual({ n: 1 });
  });

  it("excluir a automação remove suas versões (cascata)", () => {
    wf.save(id, withWait(wf.load(id).document));
    autos.remove(id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM workflow_versions").get()).toEqual({ n: 0 });
  });

  it("falha na gravação desfaz tudo (transação)", () => {
    const doc = withWait(wf.load(id).document);
    wf.save(id, doc);
    db.exec("CREATE TRIGGER boom BEFORE UPDATE ON automations BEGIN SELECT RAISE(ABORT, 'falha simulada'); END");
    const changed = { ...doc, variables: { y: { type: "number" as const, value: 1 } } };
    expect(() => wf.save(id, changed)).toThrow(/falha simulada/);
    expect(db.prepare("SELECT COUNT(*) AS n FROM workflow_versions").get()).toEqual({ n: 1 });
  });
});
