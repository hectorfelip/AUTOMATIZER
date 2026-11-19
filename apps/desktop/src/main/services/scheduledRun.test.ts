import { describe, expect, it, vi } from "vitest";
import { createScheduledRunner, parseLaunchArgs } from "./scheduledRun.js";

describe("parseLaunchArgs", () => {
  it("lê automação e agendamento; ignora os demais argumentos", () => {
    expect(parseLaunchArgs(["app.exe", "--no-sandbox", "--run-automation=abc-1", "--schedule=s_2"])).toEqual({ automationId: "abc-1", scheduleId: "s_2" });
    expect(parseLaunchArgs(["--run-automation=abc"])).toEqual({ automationId: "abc", scheduleId: null });
  });
  it.each([[[]], [["--schedule=x"]], [["--run-automation="]], [["--run-automation=a b"]], [["--run-automation=a&calc"]], [["--run-automation=../x"]], [["--run-automation=ok", "--schedule=a;b"]], [[`--run-automation=${"a".repeat(101)}`]]])("recusa %j", (argv) => {
    expect(parseLaunchArgs(argv)).toBeNull();
  });
});

const mk = (over: Partial<Parameters<typeof createScheduledRunner>[0]> = {}) => {
  const skipped: [string, string][] = [];
  const start = vi.fn(() => ({ executionId: "e" }));
  const deps = {
    waitEngineReady: async () => true,
    isRunning: () => false,
    loadSaved: () => ({ document: { x: 1 }, version: 3 }),
    automationStatus: () => "active" as const,
    scheduleEnabled: () => true,
    start,
    recordSkipped: (id: string, why: string) => void skipped.push([id, why]),
    log: () => undefined,
    ...over,
  };
  return { runner: createScheduledRunner(deps), skipped, start };
};

describe("createScheduledRunner", () => {
  it("roda a versão SALVA do fluxo, marcando a origem", async () => {
    const { runner, start, skipped } = mk();
    expect(await runner.run({ automationId: "a", scheduleId: "s" })).toBe("started");
    expect(start).toHaveBeenCalledWith("a", { x: 1 }, "s");
    expect(skipped).toEqual([]);
  });
  it.each<[string, Partial<Parameters<typeof createScheduledRunner>[0]>, string]>([
    ["agendamento desativado", { scheduleEnabled: () => false }, "skipped_disabled"],
    ["automação excluída", { automationStatus: () => null }, "skipped_missing"],
    ["automação arquivada", { automationStatus: () => "archived" }, "skipped_archived"],
    ["motor indisponível", { waitEngineReady: async () => false }, "failed_engine"],
    ["outra execução em andamento", { isRunning: () => true }, "skipped_busy"],
    ["fluxo nunca salvo", { loadSaved: () => ({ document: {}, version: 0 }) }, "skipped_unsaved"],
    ["erro ao iniciar (ex.: fluxo com erros)", { start: () => { throw new Error("O fluxo tem 1 erro"); } }, "failed_start"],
  ])("%s: não executa, registra o motivo e não lança", async (_n, over, status) => {
    const { runner, skipped, start } = mk(over);
    expect(await runner.run({ automationId: "a", scheduleId: "s" })).toBe("skipped");
    expect(skipped).toEqual([["s", status]]);
    if (status !== "failed_start") expect(start).not.toHaveBeenCalled();
  });
  it("sem id de agendamento (chamada manual) não registra nada, mas respeita as demais regras", async () => {
    const { runner, skipped } = mk({ isRunning: () => true });
    expect(await runner.run({ automationId: "a", scheduleId: null })).toBe("skipped");
    expect(skipped).toEqual([]);
  });
});
