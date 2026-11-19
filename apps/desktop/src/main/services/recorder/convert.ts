import type { RecordedStep } from "@automation-studio/shared-types";
import { createEmptyWorkflow, type WorkflowDocument } from "@automation-studio/workflow-schema";

/** Eventos normalizados que o processo gravador (`--record`) envia. Teclas digitadas em modo senha NUNCA trazem o caractere. */
export type RecEvent =
  | { t: "click"; x: number; y: number; button: "left" | "right"; ms: number }
  | { t: "char"; char: string; ms: number }
  | { t: "secret_key"; ms: number }
  | { t: "hotkey"; keys: string[]; ms: number }
  | { t: "ready" | "bye" | "stop" | "paused" | "secret" | "error"; ms?: number; [k: string]: unknown };

export type { RecordedStep };

export const LIMITS = { maxEvents: 20_000, maxSteps: 500, minWaitMs: 1000, maxWaitSeconds: 60, typeGapMs: 3000, doubleClickMs: 500, doubleClickPx: 3 };

const near = (a: number, b: number) => Math.abs(a - b) <= LIMITS.doubleClickPx;

/** Retângulo na tela (pixels); cliques dentro dele (a janela do app, o indicador) não são parte da automação. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
const inside = (r: Rect, x: number, y: number) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;

export function eventsToSteps(events: RecEvent[], ignoreClicksIn: Rect[] = []): RecordedStep[] {
  const steps: RecordedStep[] = [];
  let seq = 0;
  const id = () => `s${++seq}`;
  /** Instante (ms) do último evento que entrou no último passo, para medir a pausa até o próximo. */
  let lastMs: number | null = null;
  let lastClick: { step: RecordedStep; ms: number } | null = null;

  const gapWait = (ms: number) => {
    if (lastMs === null) return;
    const gap = ms - lastMs;
    if (gap >= LIMITS.minWaitMs) steps.push({ id: id(), kind: "wait", seconds: Math.min(LIMITS.maxWaitSeconds, Math.max(1, Math.round(gap / 1000))) });
  };
  const last = () => steps[steps.length - 1];

  for (const e of events) {
    if (steps.length >= LIMITS.maxSteps) break;
    if (e.t === "click") {
      if (ignoreClicksIn.some((r) => inside(r, e.x, e.y))) continue;
      const lc = lastClick;
      if (lc && e.button === "left" && lc.step.button === "left" && last() === lc.step && e.ms - lc.ms <= LIMITS.doubleClickMs && near(e.x, lc.step.x!) && near(e.y, lc.step.y!)) {
        lc.step.button = "double"; // dois cliques seguidos no mesmo lugar = duplo clique
        lastMs = e.ms;
        lastClick = null;
        continue;
      }
      gapWait(e.ms);
      const step: RecordedStep = { id: id(), kind: "click", x: e.x, y: e.y, button: e.button };
      steps.push(step);
      lastClick = { step, ms: e.ms };
      lastMs = e.ms;
    } else if (e.t === "char" || e.t === "secret_key") {
      const sensitive = e.t === "secret_key";
      const cur = last();
      const continues = cur?.kind === "type" && !!cur.sensitive === sensitive && lastMs !== null && e.ms - lastMs <= LIMITS.typeGapMs;
      if (continues) {
        if (!sensitive) cur!.text = (cur!.text ?? "") + (e as { char: string }).char;
      } else {
        gapWait(e.ms);
        steps.push({ id: id(), kind: "type", ...(sensitive ? { sensitive: true, text: "" } : { text: (e as { char: string }).char }) });
      }
      lastMs = e.ms;
      lastClick = null;
    } else if (e.t === "hotkey") {
      const cur = last();
      // Backspace no meio da digitação apaga o último caractere em vez de virar um passo
      if (e.keys.length === 1 && e.keys[0] === "backspace" && cur?.kind === "type" && !cur.sensitive && cur.text && lastMs !== null && e.ms - lastMs <= LIMITS.typeGapMs) {
        cur.text = cur.text.slice(0, -1);
        lastMs = e.ms;
        continue;
      }
      gapWait(e.ms);
      steps.push({ id: id(), kind: "hotkey", keys: e.keys });
      lastMs = e.ms;
      lastClick = null;
    }
  }
  return steps.slice(0, LIMITS.maxSteps);
}

/** Passos revisados → fluxo editável (Início → nós → Fim). Digitação sensível vira `{{variables.senha}}` (variável vazia a preencher). */
export function stepsToDocument(steps: RecordedStep[], docId: string, name: string): WorkflowDocument {
  const doc = createEmptyWorkflow(docId, name);
  let prev = { id: "start", port: "next" };
  let secrets = 0;
  const positions: Record<string, { x: number; y: number }> = { start: { x: 0, y: 120 } };
  const add = (type: string, config: Record<string, string | number | boolean>, outPort: string) => {
    const nid = `n${doc.nodes.length}`;
    doc.nodes.push({ id: nid, type, version: 1, config });
    doc.edges.push({ id: `e${doc.edges.length + 1}`, source: prev.id, sourceHandle: prev.port, target: nid, targetHandle: "input" });
    positions[nid] = { x: 260 * ((doc.nodes.length - 1) % 6), y: 120 + 150 * Math.floor((doc.nodes.length - 1) / 6) };
    prev = { id: nid, port: outPort };
  };
  for (const s of steps) {
    if (s.kind === "click") add("input.click", { x: s.x ?? 0, y: s.y ?? 0, button: s.button ?? "left" }, "success");
    else if (s.kind === "hotkey") add("input.hotkey", { keys: (s.keys ?? []).join("+") }, "success");
    else if (s.kind === "wait") add("flow.wait", { seconds: s.seconds ?? 1 }, "next");
    else if (s.sensitive) {
      const v = secrets++ === 0 ? "senha" : `senha${secrets}`;
      doc.variables[v] = { type: "string", value: "" };
      add("input.type_text", { text: `{{variables.${v}}}` }, "success");
    } else add("input.type_text", { text: s.text ?? "" }, "success");
  }
  const end = `n${doc.nodes.length}`;
  doc.nodes.push({ id: end, type: "flow.end", version: 1, config: { message: "Gravação concluída" } });
  doc.edges.push({ id: `e${doc.edges.length + 1}`, source: prev.id, sourceHandle: prev.port, target: end, targetHandle: "input" });
  positions[end] = { x: 260 * ((doc.nodes.length - 1) % 6), y: 120 + 150 * Math.floor((doc.nodes.length - 1) / 6) };
  doc.visual = { positions };
  return doc;
}
