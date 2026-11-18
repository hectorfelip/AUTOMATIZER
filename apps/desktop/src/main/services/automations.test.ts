import { beforeEach, describe, expect, it } from "vitest";
import { openDatabase } from "../database/db.js";
import { createAutomationService } from "./automations.js";
import { AppError } from "./errors.js";

const make = () => {
  let ids = 0;
  let tick = 0; // relógio falso: cada chamada avança 1s
  return createAutomationService(openDatabase(":memory:"), {
    newId: () => `id-${++ids}`,
    now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, ++tick)).toISOString(),
  });
};

describe("automation service", () => {
  let svc: ReturnType<typeof make>;
  beforeEach(() => {
    svc = make();
  });

  it("cria com status ativo", () => {
    const a = svc.create({ name: "Organizar PDFs", description: "" });
    expect(a).toMatchObject({ id: "id-1", name: "Organizar PDFs", status: "active" });
  });

  it("lista a mais recentemente alterada primeiro", () => {
    const a = svc.create({ name: "A", description: "" });
    svc.create({ name: "B", description: "" });
    svc.rename(a.id, "A2");
    expect(svc.list().map((x) => x.name)).toEqual(["A2", "B"]);
  });

  it("renomeia", () => {
    const a = svc.create({ name: "A", description: "" });
    expect(svc.rename(a.id, "Novo").name).toBe("Novo");
  });

  it("arquiva e restaura", () => {
    const a = svc.create({ name: "A", description: "" });
    expect(svc.setArchived(a.id, true).status).toBe("archived");
    expect(svc.setArchived(a.id, false).status).toBe("active");
  });

  it("exclui", () => {
    const a = svc.create({ name: "A", description: "" });
    svc.remove(a.id);
    expect(svc.list()).toEqual([]);
  });

  it.each([
    ["rename", (s: typeof svc) => s.rename("x", "N")],
    ["setArchived", (s: typeof svc) => s.setArchived("x", true)],
    ["remove", (s: typeof svc) => s.remove("x")],
  ])("%s de id inexistente dá NOT_FOUND", (_n, fn) => {
    expect(() => fn(svc)).toThrow(AppError);
    try {
      fn(svc);
    } catch (e) {
      expect((e as AppError).code).toBe("NOT_FOUND");
    }
  });
});
