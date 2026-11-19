import { describe, expect, it } from "vitest";
import { hasErrors, validateWorkflow } from "@automation-studio/workflow-validator";
import { eventsToSteps, stepsToDocument, type RecEvent, type RecordedStep } from "./convert.js";

const click = (x: number, y: number, ms: number, button: "left" | "right" = "left"): RecEvent => ({ t: "click", x, y, button, ms });
const chars = (text: string, from: number, step = 80): RecEvent[] => [...text].map((c, i) => ({ t: "char", char: c, ms: from + i * step }));
const secret = (n: number, from: number): RecEvent[] => Array.from({ length: n }, (_, i) => ({ t: "secret_key", ms: from + i * 80 }));
const hot = (keys: string[], ms: number): RecEvent => ({ t: "hotkey", keys, ms });
const kinds = (s: RecordedStep[]) => s.map((x) => x.kind);

describe("eventsToSteps", () => {
  it("agrupa digitação contínua em um passo de texto", () => {
    const s = eventsToSteps([click(10, 20, 100), ...chars("Olá mundo", 300)]);
    expect(kinds(s)).toEqual(["click", "type"]);
    expect(s[1]).toMatchObject({ text: "Olá mundo" });
  });

  it("duplo clique: dois cliques esquerdos no mesmo ponto em até 500 ms", () => {
    const s = eventsToSteps([click(100, 100, 0), click(101, 99, 300)]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ kind: "click", button: "double", x: 100, y: 100 });
    // lento demais, longe ou botão direito = cliques separados (e a espera entre eles só vira passo se ≥ 1 s)
    expect(kinds(eventsToSteps([click(100, 100, 0), click(100, 100, 900)]))).toEqual(["click", "click"]);
    expect(kinds(eventsToSteps([click(100, 100, 0), click(200, 100, 100)]))).toEqual(["click", "click"]);
    expect(kinds(eventsToSteps([click(100, 100, 0, "right"), click(100, 100, 100, "right")]))).toEqual(["click", "click"]);
  });

  it("pausas de 1 s ou mais viram 'esperar' (arredondado, no máximo 60 s); menores são ignoradas", () => {
    const s = eventsToSteps([click(1, 1, 0), click(500, 500, 2400), click(900, 900, 2900), click(5, 5, 200_000)]);
    expect(s.map((x) => (x.kind === "wait" ? `w${x.seconds}` : x.kind))).toEqual(["click", "w2", "click", "click", "w60", "click"]);
  });

  it("atalhos viram passos e Backspace no meio do texto apaga em vez de virar passo", () => {
    const s = eventsToSteps([...chars("abcd", 0), hot(["backspace"], 400), hot(["enter"], 500), hot(["ctrl", "s"], 700)]);
    expect(s[0]).toMatchObject({ kind: "type", text: "abc" });
    expect(s.slice(1).map((x) => x.keys)).toEqual([["enter"], ["ctrl", "s"]]);
    // sem texto antes, Backspace é um passo
    expect(eventsToSteps([hot(["backspace"], 0)])[0]).toMatchObject({ kind: "hotkey", keys: ["backspace"] });
  });

  it("MODO SENHA: digitação sensível vira um passo SEM texto, separado da digitação normal", () => {
    const s = eventsToSteps([...chars("usuario", 0), hot(["tab"], 700), ...secret(10, 900), hot(["enter"], 1900), ...chars("ok", 2000)]);
    expect(kinds(s)).toEqual(["type", "hotkey", "type", "hotkey", "type"]);
    expect(s[0]).toMatchObject({ text: "usuario" });
    expect(s[2]).toMatchObject({ sensitive: true, text: "" });
    expect(JSON.stringify(s)).not.toMatch(/secret_key/);
    expect(s[4]).toMatchObject({ text: "ok" });
  });

  it("ignora cliques dentro das janelas do app/indicador (o clique em 'Parar' não faz parte da gravação)", () => {
    const rects = [{ x: 0, y: 0, width: 300, height: 200 }];
    expect(eventsToSteps([click(100, 100, 0), click(400, 400, 50)], rects).map((x) => x.x)).toEqual([400]);
  });

  it("ignora eventos de controle e respeita o limite de passos", () => {
    expect(eventsToSteps([{ t: "ready" }, { t: "paused", on: true, ms: 1 }, { t: "stop", ms: 2 }, { t: "bye" }])).toEqual([]);
    const many = Array.from({ length: 2000 }, (_, i) => click(i, i, i * 2000));
    expect(eventsToSteps(many).length).toBeLessThanOrEqual(500);
  });
});

describe("stepsToDocument", () => {
  const steps = (): RecordedStep[] => eventsToSteps([click(10, 20, 0), ...chars("oi", 3000), hot(["enter"], 4000), ...secret(4, 6000)]);

  it("gera um fluxo VÁLIDO: Início → nós → Fim, com portas e posições", () => {
    const d = stepsToDocument(steps(), "doc1", "Gravação");
    expect(hasErrors(validateWorkflow(d))).toBe(false);
    expect(d.nodes.map((n) => n.type)).toEqual(["trigger.manual", "input.click", "flow.wait", "input.type_text", "input.hotkey", "flow.wait", "input.type_text", "flow.end"]);
    expect(d.nodes[1]!.config).toEqual({ x: 10, y: 20, button: "left" });
    expect(d.nodes[4]!.config).toEqual({ keys: "enter" });
    expect(d.nodes.every((n) => d.visual.positions[n.id])).toBe(true);
    expect(d.edges).toHaveLength(d.nodes.length - 1);
  });

  it("senha vira {{variables.senha}} (variável vazia a preencher), nunca texto", () => {
    const d = stepsToDocument(eventsToSteps([...secret(3, 0), hot(["tab"], 500), ...secret(3, 900)]), "d", "G");
    expect(Object.keys(d.variables)).toEqual(["senha", "senha2"]);
    expect(d.variables["senha"]).toEqual({ type: "string", value: "" });
    expect(d.nodes.filter((n) => n.type === "input.type_text").map((n) => n.config["text"])).toEqual(["{{variables.senha}}", "{{variables.senha2}}"]);
  });

  it("gravação vazia ainda gera Início → Fim válido", () => {
    const d = stepsToDocument([], "d", "Vazia");
    expect(d.nodes.map((n) => n.type)).toEqual(["trigger.manual", "flow.end"]);
    expect(hasErrors(validateWorkflow(d))).toBe(false);
  });

  it("texto digitado com {{ }} é sinalizado pelo validador (não é interpretado em silêncio)", () => {
    const d = stepsToDocument(eventsToSteps(chars("{{variables.x}}", 0)), "d", "G");
    expect(hasErrors(validateWorkflow(d))).toBe(true);
  });
});
