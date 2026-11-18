import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, createHistory, redo, undo } from "./history";

describe("history", () => {
  it("desfaz e refaz em ordem", () => {
    let h = createHistory("a");
    h = commit(h, "b");
    h = commit(h, "c");
    expect(h.present).toBe("c");
    h = undo(h);
    expect(h.present).toBe("b");
    h = undo(h);
    expect(h.present).toBe("a");
    expect(canUndo(h)).toBe(false);
    expect(undo(h)).toBe(h);
    h = redo(h);
    h = redo(h);
    expect(h.present).toBe("c");
    expect(canRedo(h)).toBe(false);
    expect(redo(h)).toBe(h);
  });

  it("nova mudança descarta o futuro", () => {
    let h = commit(commit(createHistory("a"), "b"), "c");
    h = undo(h);
    h = commit(h, "x");
    expect(h.future).toEqual([]);
    expect(canRedo(h)).toBe(false);
  });

  it("mesma referência não cria passo", () => {
    const h = createHistory({ n: 1 });
    expect(commit(h, h.present)).toBe(h);
  });

  it("junta mudanças com a mesma chave dentro de 1s (digitação)", () => {
    let h = createHistory("");
    h = commit(h, "o", "cfg:x", 1000);
    h = commit(h, "ol", "cfg:x", 1300);
    h = commit(h, "olá", "cfg:x", 1600);
    expect(h.past).toEqual([""]); // um único passo
    expect(undo(h).present).toBe("");
  });

  it("não junta chaves diferentes nem mudanças separadas por mais de 1s", () => {
    let h = createHistory("");
    h = commit(h, "a", "k1", 1000);
    h = commit(h, "ab", "k2", 1100);
    h = commit(h, "abc", "k2", 5000);
    expect(h.past.length).toBe(3);
  });

  it("desfazer encerra a janela de junção", () => {
    let h = commit(createHistory(""), "a", "k", 1000);
    h = undo(h);
    h = commit(h, "b", "k", 1100);
    expect(h.past).toEqual([""]);
    expect(undo(h).present).toBe("");
  });

  it("limita o histórico a 100 passos", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 150; i++) h = commit(h, i);
    expect(h.past.length).toBe(100);
    expect(h.past[0]).toBe(50);
  });
});
