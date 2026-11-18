import { describe, expect, it } from "vitest";
import { hasErrors, validateWorkflow } from "@automation-studio/workflow-validator";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "./automations.js";
import { AppError } from "./errors.js";
import { createTemplatesService, templates } from "./templates.js";
import { createWorkflowService } from "./workflows.js";

describe("exemplos prontos", () => {
  it("há exemplos e os ids são únicos", () => {
    expect(templates.length).toBeGreaterThanOrEqual(4);
    expect(new Set(templates.map((t) => t.id)).size).toBe(templates.length);
  });

  it.each(templates.map((t) => [t.id, t] as const))("%s: é válido e pronto para executar (sem erros)", (_id, t) => {
    const issues = validateWorkflow(t.workflow);
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(hasErrors(issues)).toBe(false);
    expect(t.name.length).toBeGreaterThan(5);
    expect(t.description.length).toBeGreaterThan(20);
  });

  it("cobrem arquivos, decisão, repetição e janela/teclado", () => {
    const types = new Set(templates.flatMap((t) => t.workflow.nodes.map((n) => n.type)));
    for (const needed of ["files.move", "files.exists", "files.create_folder", "flow.repeat", "windows.open_app", "windows.activate_window", "input.type_text"]) {
      expect(types.has(needed), needed).toBe(true);
    }
  });

  it("só o exemplo de janela/teclado é marcado como 'somente Windows'", () => {
    expect(templates.filter((t) => t.windowsOnly).map((t) => t.id)).toEqual(["bloco-de-notas"]);
  });
});

describe("createAutomation a partir de exemplo", () => {
  const setup = () => {
    const db = openDatabase(":memory:");
    const automations = createAutomationService(db);
    const workflows = createWorkflowService(db);
    return { db, automations, workflows, svc: createTemplatesService({ automations, workflows }) };
  };

  it("cria a automação e grava o fluxo como versão 1, com id e nome da nova automação", () => {
    const { svc, workflows, automations } = setup();
    const a = svc.createAutomation("organizar-pdfs", "Meus PDFs");
    expect(a).toMatchObject({ name: "Meus PDFs", status: "active" });
    const loaded = workflows.load(a.id);
    expect(loaded.version).toBe(1);
    expect(loaded.document).toMatchObject({ id: a.id, name: "Meus PDFs" });
    expect(loaded.document.nodes.length).toBe(templates.find((t) => t.id === "organizar-pdfs")!.workflow.nodes.length);
    expect(automations.list()).toHaveLength(1);
  });

  it("sem nome usa o do exemplo; criar duas vezes dá automações independentes", () => {
    const { svc } = setup();
    const a = svc.createAutomation("repetir-esperar");
    const b = svc.createAutomation("repetir-esperar");
    expect(a.name).toBe(templates.find((t) => t.id === "repetir-esperar")!.name);
    expect(a.id).not.toBe(b.id);
  });

  it("exemplo inexistente → NOT_FOUND e nada é criado", () => {
    const { svc, automations } = setup();
    expect(() => svc.createAutomation("nao-existe")).toThrow(AppError);
    expect(automations.list()).toHaveLength(0);
  });

  it("falha ao gravar o fluxo não deixa automação pela metade", () => {
    const { svc, automations, db } = setup();
    db.exec("CREATE TRIGGER boom BEFORE INSERT ON workflow_versions BEGIN SELECT RAISE(ABORT, 'disco cheio'); END");
    expect(() => svc.createAutomation("organizar-pdfs")).toThrow(/disco cheio/);
    expect(automations.list()).toHaveLength(0);
  });

  it("editar a cópia não altera o exemplo (cada automação tem sua cópia)", () => {
    const { svc, workflows } = setup();
    const a = svc.createAutomation("repetir-esperar");
    const doc = workflows.load(a.id).document;
    doc.variables["voltas"] = { type: "number", value: 99 };
    workflows.save(a.id, doc);
    const b = svc.createAutomation("repetir-esperar");
    expect(workflows.load(b.id).document.variables["voltas"]).toEqual({ type: "number", value: 3 });
  });
});
