import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { LIMITS } from "./convert.js";
import { createRecorderService, type RecorderStatus } from "./recorder.js";

/** Processo falso: o teste "digita" no stdout dele e lê o que o serviço escreve no stdin. */
function fakeChild() {
  const stdout = new PassThrough();
  const stdin = new PassThrough();
  const stderr = new PassThrough();
  const ee = new EventEmitter();
  const written: string[] = [];
  stdin.on("data", (d) => written.push(String(d)));
  const c = Object.assign(ee, {
    stdout, stdin, stderr, exitCode: null as number | null,
    kill() {
      c.exitCode = 1;
      ee.emit("exit", 1);
    },
  });
  const send = (o: unknown) => stdout.write(JSON.stringify(o) + "\n");
  return { c: c as never, stdout, stderr, send, written, exit: () => { c.exitCode = 0; ee.emit("exit", 0); } };
}
const tick = () => new Promise((r) => setTimeout(r, 15));

function setup(opts: { supported?: boolean } = {}) {
  const f = fakeChild();
  const statuses: RecorderStatus[] = [];
  let spawned = 0;
  const clock = { t: 1000 };
  const svc = createRecorderService({ spawn: () => (spawned++, f.c), supported: opts.supported ?? true, onStatus: (s) => statuses.push(s), ignoreRects: () => [{ x: 0, y: 0, width: 100, height: 100 }], now: () => clock.t, startTimeoutMs: 300, stopTimeoutMs: 300 });
  return { f, svc, statuses, spawned: () => spawned, clock };
}
const begin = async (s: ReturnType<typeof setup>) => {
  const p = s.svc.start();
  await tick();
  s.f.send({ t: "ready" });
  return p;
};

describe("serviço do gravador", () => {
  it("grava em memória, conta eventos e devolve passos na parada", async () => {
    const s = setup();
    await begin(s);
    expect(s.svc.status()).toMatchObject({ state: "recording", events: 0 });
    s.f.send({ t: "click", x: 500, y: 600, button: "left", ms: 0 });
    s.f.send({ t: "char", char: "o", ms: 3000 });
    s.f.send({ t: "char", char: "i", ms: 3050 });
    await tick();
    expect(s.svc.status().events).toBe(3);
    const steps = await s.svc.stop();
    expect(s.f.written.join("")).toContain("stop");
    expect(steps.map((x) => x.kind)).toEqual(["click", "wait", "type"]);
    expect(steps[2]).toMatchObject({ text: "oi" });
    s.svc.finish();
    expect(s.svc.status()).toMatchObject({ state: "idle", events: 0 }); // tudo apagado
  });

  it("cliques REAIS em qualquer lugar da tela são mantidos: só o clique no botão do app (Parar/Pausar), recente e último, é descartado", async () => {
    // com a janela do app VISÍVEL e o clique recém-chegado (e último): é o clique no botão, descartado ao parar pela interface
    const s = setup();
    await begin(s);
    s.f.send({ t: "click", x: 10, y: 10, button: "left", ms: 0 });
    await tick();
    expect((await s.svc.stop()).map((x) => x.kind)).toEqual([]);
    s.svc.finish();

    // clique antigo (não é o do botão) dentro da área: mantido
    const s2 = setup();
    await begin(s2);
    s2.f.send({ t: "click", x: 10, y: 10, button: "left", ms: 0 });
    await tick();
    s2.clock.t += 5000;
    expect((await s2.svc.stop()).map((x) => x.kind)).toEqual(["click"]);
    s2.svc.finish();

    // parada pelo ATALHO global: nada é descartado
    const s3 = setup();
    await begin(s3);
    s3.f.send({ t: "click", x: 10, y: 10, button: "left", ms: 0 });
    s3.f.send({ t: "stop", ms: 5 });
    await tick();
    expect((await s3.svc.stop()).map((x) => x.kind)).toEqual(["click"]);
  });

  it("pausa/modo senha vêm do processo (atalhos globais) e aparecem no status", async () => {
    const s = setup();
    await begin(s);
    s.f.send({ t: "paused", on: true });
    s.f.send({ t: "secret", on: true });
    await tick();
    expect(s.svc.status()).toMatchObject({ paused: true, secret: true });
    s.svc.pause();
    expect(s.f.written.join("")).toContain("pause");
  });

  it("parada pelo atalho global (Ctrl+Alt+R) leva a 'stopping' e dá para revisar", async () => {
    const s = setup();
    await begin(s);
    s.f.send({ t: "click", x: 300, y: 300, button: "left", ms: 5 });
    s.f.send({ t: "stop", ms: 10 });
    await tick();
    expect(s.svc.status().state).toBe("stopping");
    expect((await s.svc.stop()).map((x) => x.kind)).toEqual(["click"]);
  });

  it("fora do Windows não grava e não inicia processo", async () => {
    const s = setup({ supported: false });
    await expect(s.svc.start()).rejects.toMatchObject({ code: "VALIDATION", message: expect.stringContaining("Windows") });
    expect(s.spawned()).toBe(0);
  });

  it("erro do gravador (ex.: pynput ausente) vira mensagem clara e volta a 'idle'", async () => {
    const s = setup();
    const p = s.svc.start();
    await tick();
    s.f.send({ t: "error", code: "DEPENDENCY_MISSING", message: "A biblioteca pynput não pôde ser carregada. Instale com pip." });
    await expect(p).rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE", message: expect.stringContaining("pynput") });
    expect(s.svc.status().state).toBe("idle");
  });

  it("processo que morre ao iniciar ou nunca responde: erro claro, sem ficar preso", async () => {
    const s = setup();
    const p = s.svc.start();
    await tick();
    s.f.exit();
    await expect(p).rejects.toMatchObject({ code: "ENGINE_UNAVAILABLE" });
    expect(s.svc.status().state).toBe("idle");
    const s2 = setup();
    await expect(s2.svc.start()).rejects.toThrow(/não respondeu/);
    expect(s2.svc.status().state).toBe("idle");
  });

  it("só uma gravação por vez; parar/pausar sem gravar → erro", async () => {
    const s = setup();
    await begin(s);
    await expect(s.svc.start()).rejects.toMatchObject({ code: "EXECUTION_BUSY" });
    s.svc.finish();
    expect(() => s.svc.pause()).toThrow();
    await expect(s.svc.stop()).rejects.toThrow();
  });

  it("limite de eventos: avisa e manda parar (nunca cresce sem fim)", async () => {
    const s = setup();
    await begin(s);
    for (let i = 0; i < LIMITS.maxEvents + 5; i++) s.f.send({ t: "char", char: "a", ms: i });
    await new Promise((r) => setTimeout(r, 300));
    expect(s.svc.status().events).toBe(LIMITS.maxEvents);
    expect(s.svc.status().notice).toContain("Limite");
    expect(s.f.written.join("")).toContain("stop");
  });

  it("linhas que não são JSON e stderr são ignorados (stderr nunca é logado: pode conter teclas)", async () => {
    const s = setup();
    await begin(s);
    s.f.stdout.write("lixo que não é json\n");
    s.f.stderr.write("tecla secreta s3nha\n");
    s.f.send({ t: "char", char: "a", ms: 1 });
    await tick();
    expect(s.svc.status().events).toBe(1);
  });
});

describe("processo que já terminou (Ctrl+Alt+R): nada pode derrubar o app", () => {
  it("EPIPE no stdin depois da parada pelo atalho não é exceção; parar segue funcionando", async () => {
    const s = setup();
    await begin(s);
    s.f.send({ t: "click", x: 300, y: 300, button: "left", ms: 1 });
    s.f.send({ t: "stop", ms: 5 }); // atalho global: o processo vai encerrar
    await tick();
    s.f.exit();
    // o pipe quebra: sem tratador de 'error' isto seria uma exceção não capturada no Main (o erro do print do Hector)
    const c = s.f.c as unknown as { stdin: { emit(e: string, err: Error): void } };
    c.stdin.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
    s.f.stdout.emit("error", Object.assign(new Error("read EPIPE"), { code: "EPIPE" }));
    const steps = await s.svc.stop(); // a interface pede os passos DEPOIS do processo ter morrido
    expect(steps.map((x) => x.kind)).toEqual(["click"]);
  });

  it("pausar e parar com o stdin já destruído não lançam", async () => {
    const s = setup();
    await begin(s);
    (s.f.c as unknown as { stdin: { destroy(): void } }).stdin.destroy();
    expect(() => s.svc.pause()).not.toThrow();
    await expect(s.svc.stop()).resolves.toBeDefined();
  });
});

describe("createFromRecording", () => {
  it("cria a automação (versão 1, sem executar) a partir dos passos; recusa passos inválidos sem deixar nada", async () => {
    const { openDatabase } = await import("../../database/db.js");
    const { createAutomationService } = await import("../automations.js");
    const { createWorkflowService } = await import("../workflows.js");
    const { createFromRecording } = await import("./create.js");
    const db = openDatabase(":memory:");
    const automations = createAutomationService(db);
    const workflows = createWorkflowService(db);
    const a = createFromRecording({ automations, workflows }, "Gravada", [
      { id: "s1", kind: "click", x: 10, y: 20, button: "left" },
      { id: "s2", kind: "type", text: "oi" },
      { id: "s3", kind: "type", sensitive: true, text: "" },
    ]);
    const { document, version } = workflows.load(a.id);
    expect(version).toBe(1);
    expect(document.nodes.map((n) => n.type)).toEqual(["trigger.manual", "input.click", "input.type_text", "input.type_text", "flow.end"]);
    expect(document.variables["senha"]).toEqual({ type: "string", value: "" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM executions").get() as { n: number }).n).toBe(0); // nunca executa
    expect(() => createFromRecording({ automations, workflows }, "Ruim", [{ id: "s1", kind: "type", text: "{{variables.x}}" }])).toThrow(/problema/);
    expect(automations.list()).toHaveLength(1); // a inválida não deixou automação pela metade
  });
});
