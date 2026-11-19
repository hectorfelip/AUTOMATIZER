import { describe, expect, it } from "vitest";
import { resolveEngineLaunch, type LaunchContext } from "./launch.js";

const ctx = (over: Partial<LaunchContext> = {}): LaunchContext => ({
  platform: "linux", env: {}, isPackaged: false, resourcesPath: "/res", repoRoot: "/repo", ...over,
});

describe("resolveEngineLaunch", () => {
  it("dev em Linux usa python3 -m automation_engine na pasta do motor", () => {
    const l = resolveEngineLaunch(ctx());
    expect(l.command).toBe("python3");
    expect(l.args).toEqual(["-m", "automation_engine"]);
    expect(l.cwd).toMatch(/engine[\\/]python$/);
    expect(l.env).toMatchObject({ PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" });
  });
  it("dev em Windows usa o launcher py -3", () => {
    const l = resolveEngineLaunch(ctx({ platform: "win32" }));
    expect([l.command, ...l.args]).toEqual(["py", "-3", "-m", "automation_engine"]);
  });
  it("AUTOMATION_STUDIO_PYTHON tem prioridade em dev", () => {
    expect(resolveEngineLaunch(ctx({ env: { AUTOMATION_STUDIO_PYTHON: "/opt/py/bin/python" } })).command).toBe("/opt/py/bin/python");
  });
  it("app empacotado usa o executável em resources/engine (sem Python global)", () => {
    expect(resolveEngineLaunch(ctx({ isPackaged: true })).command).toMatch(/res[\\/]engine[\\/]automation-engine$/);
    expect(resolveEngineLaunch(ctx({ isPackaged: true, platform: "win32" })).command).toMatch(/automation-engine\.exe$/);
  });
  it("AUTOMATION_STUDIO_ENGINE vence tudo (validar o empacotamento)", () => {
    const l = resolveEngineLaunch(ctx({ isPackaged: true, env: { AUTOMATION_STUDIO_ENGINE: "C:\\x\\engine.exe" } }));
    expect(l).toEqual({ command: "C:\\x\\engine.exe", args: [] });
  });
  it("só repassa o flag de ações de teste quando pedido", () => {
    expect(resolveEngineLaunch(ctx()).env).not.toHaveProperty("AUTOMATION_ENGINE_TEST_ACTIONS");
    expect(resolveEngineLaunch(ctx({ env: { AUTOMATION_ENGINE_TEST_ACTIONS: "1" } })).env).toHaveProperty("AUTOMATION_ENGINE_TEST_ACTIONS", "1");
  });

  it("repassa ao motor só as variáveis do navegador (nunca o ambiente inteiro)", () => {
    const env = resolveEngineLaunch(ctx({ env: { AUTOMATION_BROWSER_PATH: "/x/chrome", AUTOMATION_BROWSER_NO_SANDBOX: "1", SEGREDO: "nao" } })).env!;
    expect(env).toMatchObject({ AUTOMATION_BROWSER_PATH: "/x/chrome", AUTOMATION_BROWSER_NO_SANDBOX: "1" });
    expect(env).not.toHaveProperty("SEGREDO");
    expect(resolveEngineLaunch(ctx()).env).not.toHaveProperty("AUTOMATION_BROWSER_PATH");
  });
});
