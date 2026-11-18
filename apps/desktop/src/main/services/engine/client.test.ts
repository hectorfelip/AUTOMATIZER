import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { EngineStatus } from "@automation-studio/shared-types";
import { EngineClient, type EngineClientOptions } from "./client.js";
import { resolveEngineLaunch } from "./launch.js";

const repoRoot = resolve(import.meta.dirname, "../../../../../..");
const fixture = resolve(import.meta.dirname, "__fixtures__/fake-engine.mjs");

const realLaunch = () =>
  resolveEngineLaunch({ platform: process.platform, env: { ...process.env, AUTOMATION_ENGINE_TEST_ACTIONS: "1" }, isPackaged: false, resourcesPath: "", repoRoot });
const fakeLaunch = (mode: string) => () => ({ command: process.execPath, args: [fixture], env: { FAKE_MODE: mode } });

const clients: EngineClient[] = [];
const FAST: Partial<EngineClientOptions> = { heartbeatMs: 80, maxMissedPings: 3, readyTimeoutMs: 1500, restartBackoffMs: [20, 20, 20], stopGraceMs: 800 };
function make(launch: EngineClientOptions["launch"], over: Partial<EngineClientOptions> = {}) {
  const logs: string[] = [];
  const c = new EngineClient({ launch, log: (l, m) => logs.push(`${l}: ${m}`), ...FAST, ...over });
  const history: EngineStatus["state"][] = [];
  c.on("status", (s: EngineStatus) => history.push(s.state));
  clients.push(c);
  return { c, logs, history };
}
const until = async (c: EngineClient, pred: (s: EngineStatus) => boolean, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (pred(c.status)) return c.status;
    await new Promise((r) => setTimeout(r, 15));
  }
  throw new Error(`timeout esperando status; atual: ${JSON.stringify(c.status)}`);
};
const ready = (c: EngineClient) => until(c, (s) => s.state === "ready");
const req = (action: string, config: Record<string, string | number | boolean | null> = {}, executionId = "e1") => ({ executionId, nodeId: "n1", action, config });

afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.stop()));
});

describe("EngineClient com o motor Python real", () => {
  it("inicia, faz handshake e informa as ações disponíveis", async () => {
    const { c } = make(realLaunch);
    c.start();
    const s = await ready(c);
    expect(s).toMatchObject({ state: "ready", engineVersion: "0.1.0" });
    if (s.state === "ready") expect(s.actions).toContain("flow.wait");
  });

  it("executa uma ação e entrega progresso", async () => {
    const { c } = make(realLaunch);
    c.start();
    await ready(c);
    const progress: number[] = [];
    const out = await c.executeAction(req("flow.wait", { seconds: 1.5 }), (p) => p.percent !== undefined && progress.push(p.percent));
    expect(out).toMatchObject({ kind: "completed", outputs: { waitedSeconds: 1.5 } });
    expect(progress.at(-1)).toBe(100);
  });

  it("erros de ação chegam como 'failed' com código", async () => {
    const { c } = make(realLaunch);
    c.start();
    await ready(c);
    expect(await c.executeAction(req("nao.existe"))).toMatchObject({ kind: "failed", error: { code: "ACTION_NOT_IMPLEMENTED" } });
    expect(await c.executeAction(req("flow.wait", { seconds: "abc" }))).toMatchObject({ kind: "failed", error: { code: "INVALID_CONFIG" } });
    expect(await c.executeAction(req("test.fail"))).toMatchObject({ kind: "failed", error: { code: "TEST_FAILURE" } });
  });

  it("cancelamento cooperativo é rápido e NÃO reinicia o motor", async () => {
    const { c, history } = make(realLaunch);
    c.start();
    await ready(c);
    const p = c.executeAction(req("flow.wait", { seconds: 60 }));
    await new Promise((r) => setTimeout(r, 150));
    const t0 = Date.now();
    c.cancel("e1");
    expect(await p).toEqual({ kind: "cancelled" });
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(history).toEqual(["ready"]); // nenhum restarting
    expect(await c.executeAction(req("flow.wait", { seconds: 0 }))).toMatchObject({ kind: "completed" });
  });

  it("ação que ignora o cancelamento: motor é morto, reinicia e segue funcionando", async () => {
    const { c, history } = make(realLaunch);
    c.start();
    await ready(c);
    const p = c.executeAction(req("test.hang"));
    await new Promise((r) => setTimeout(r, 150));
    c.cancel("e1", 300);
    expect(await p).toEqual({ kind: "cancelled" });
    await until(c, (s) => s.state === "restarting" || s.state === "ready");
    await ready(c);
    expect(history).toContain("restarting");
    expect(await c.executeAction(req("flow.wait", { seconds: 0 }))).toMatchObject({ kind: "completed" });
  });

  it("queda do motor no meio da ação: erro claro, o app não cai e o motor volta", async () => {
    const { c, history } = make(realLaunch);
    c.start();
    await ready(c);
    const out = await c.executeAction(req("test.crash"));
    expect(out).toMatchObject({ kind: "failed", error: { code: "ENGINE_CRASHED" } });
    await ready(c);
    expect(history).toContain("restarting");
    expect(await c.executeAction(req("flow.wait", { seconds: 0 }))).toMatchObject({ kind: "completed" });
  });

  it("ruído (print) de ação mal-comportada não corrompe a comunicação", async () => {
    const { c, logs } = make(realLaunch);
    c.start();
    await ready(c);
    expect(await c.executeAction(req("test.noise"))).toMatchObject({ kind: "completed", outputs: { ok: true } });
    // stderr é outro pipe: pode chegar depois da resposta da ação, então esperamos em vez de assumir ordem
    for (let i = 0; i < 100 && !logs.some((l) => l.includes("RUIDO NO STDOUT")); i++) await new Promise((r) => setTimeout(r, 20));
    expect(logs.some((l) => l.includes("RUIDO NO STDOUT"))).toBe(true); // foi parar no stderr/log
    expect(logs.some((l) => l.includes("Linha inválida"))).toBe(false); // e nada de lixo no protocolo
  });

  it("recusa ação quando o motor não está pronto, sem travar", async () => {
    const { c } = make(realLaunch);
    const out = await c.executeAction(req("flow.wait", { seconds: 0 }));
    expect(out).toMatchObject({ kind: "failed", error: { code: "ENGINE_UNAVAILABLE" } });
  });

  it("stop() faz shutdown limpo e resolve ações pendentes", async () => {
    const { c } = make(realLaunch);
    c.start();
    await ready(c);
    const p = c.executeAction(req("flow.wait", { seconds: 60 }));
    await new Promise((r) => setTimeout(r, 100));
    await c.stop();
    expect(await p).toMatchObject({ kind: "failed" });
    expect(c.status).toEqual({ state: "unavailable", reason: "O motor foi encerrado." });
  });
});

describe("EngineClient contra motores com defeito", () => {
  it("tolera lixo no stdout (linhas inválidas, tipos desconhecidos) e segue funcionando", async () => {
    const { c, logs } = make(fakeLaunch("garbage"));
    c.start();
    await ready(c);
    expect(logs.filter((l) => l.startsWith("warn")).length).toBeGreaterThanOrEqual(3);
    expect(await c.executeAction(req("x", { a: 1 }))).toMatchObject({ kind: "completed", outputs: { echo: { a: 1 } } });
  });

  it("descarta linha maior que 1 MiB e continua lendo mensagens válidas", async () => {
    // a cada ping o motor falso manda uma linha de 1,2 MB e DEPOIS um pong válido
    const { c, logs } = make(fakeLaunch("oversize"), { heartbeatMs: 50, maxMissedPings: 1000 });
    c.start();
    await ready(c);
    await new Promise((r) => setTimeout(r, 400));
    expect(logs.some((l) => l.includes("1 MiB"))).toBe(true);
    expect(c.status.state).toBe("ready"); // o leitor se recuperou: o heartbeat segue saudável
    expect(await c.executeAction(req("x"))).toMatchObject({ kind: "completed" });
  });

  it("mensagem quebrada em pedaços de 1 byte é remontada", async () => {
    const { c } = make(fakeLaunch("split"));
    c.start();
    expect((await ready(c)).state).toBe("ready");
  });

  it("comando inexistente: indisponível com instrução, sem laço de reinício", async () => {
    const { c, history } = make(() => ({ command: "/caminho/que/nao/existe/python", args: [] }));
    c.start();
    const s = await until(c, (x) => x.state === "unavailable");
    expect(s).toMatchObject({ state: "unavailable" });
    if (s.state === "unavailable") expect(s.reason).toMatch(/não encontrado.*Python 3\.11/s);
    await new Promise((r) => setTimeout(r, 200));
    expect(history).toEqual(["unavailable"]);
  });

  it("pasta do motor inexistente não é confundida com 'comando não encontrado'", async () => {
    const { c } = make(() => ({ command: process.execPath, args: [], cwd: "/pasta/que/nao/existe" }));
    c.start();
    const s = await until(c, (x) => x.state === "unavailable");
    if (s.state === "unavailable") {
      expect(s.reason).toMatch(/pasta do motor não foi encontrada.*\/pasta\/que\/nao\/existe/);
      expect(s.reason).not.toMatch(/não encontrado\)/);
    }
  });

  it("launch() que lança erro vira indisponível", async () => {
    const { c } = make(() => {
      throw new Error("sem pasta do motor");
    });
    c.start();
    const s = await until(c, (x) => x.state === "unavailable");
    if (s.state === "unavailable") expect(s.reason).toContain("sem pasta do motor");
  });

  it("falha repetida ao iniciar: reinicia poucas vezes, depois indisponível com o último erro", async () => {
    let launches = 0;
    const inner = fakeLaunch("crash-loop");
    const { c } = make(() => (launches++, inner()), { maxRestarts: 2 });
    c.start();
    const s = await until(c, (x) => x.state === "unavailable");
    if (s.state === "unavailable") expect(s.reason).toMatch(/falhou 3 vezes.*ModuleNotFoundError/s);
    expect(launches).toBe(3); // 1ª tentativa + 2 reinícios, depois desiste
  });

  it("motor que não responde ao heartbeat é morto e reiniciado", async () => {
    const { c, history, logs } = make(fakeLaunch("ignore-ping"));
    c.start();
    await ready(c);
    await until(c, (s) => s.state === "restarting", 4000);
    expect(logs.some((l) => l.includes("não responde ao heartbeat"))).toBe(true);
    expect(history).toContain("restarting");
  });

  it("ação em voo quando o motor trava recebe erro claro (e não fica pendurada)", async () => {
    const { c } = make(fakeLaunch("hang"));
    c.start();
    await ready(c);
    const out = await c.executeAction(req("x")); // o motor aceita e nunca responde; o heartbeat o derruba
    expect(out).toEqual({ kind: "failed", error: { code: "ENGINE_CRASHED", message: "O motor parou de responder." } });
  });

  it("não sobe se nunca disser 'ready'", async () => {
    const { c } = make(fakeLaunch("silent"), { readyTimeoutMs: 200, maxRestarts: 0 });
    c.start();
    const s = await until(c, (x) => x.state === "unavailable");
    if (s.state === "unavailable") expect(s.reason).toMatch(/não respondeu ao iniciar/);
  });

  it("protocolo incompatível e Python antigo viram indisponível, sem reiniciar", async () => {
    for (const [mode, re] of [["bad-protocol", /protocolo v99/], ["old-python", /3\.8\.10.*antigo/]] as const) {
      const { c, history } = make(fakeLaunch(mode));
      c.start();
      const s = await until(c, (x) => x.state === "unavailable");
      if (s.state === "unavailable") expect(s.reason).toMatch(re);
      await new Promise((r) => setTimeout(r, 150));
      expect(history).not.toContain("restarting");
    }
  });
});
