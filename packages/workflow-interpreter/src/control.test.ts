import { describe, expect, it } from "vitest";
import { coerceToDeclared, evaluateCondition } from "./control.js";

const val = (l: string, op: string, r: string) => {
  const c = evaluateCondition(l, op, r);
  if (!c.ok) throw new Error(c.message);
  return c.value;
};

describe("evaluateCondition", () => {
  it("igualdade: numérica quando ambos são números, textual senão", () => {
    expect(val("5", "equals", "5.0")).toBe(true); // 5 == 5.0 como número
    expect(val("abc", "equals", "abc")).toBe(true);
    expect(val("abc", "equals", "ABC")).toBe(false); // textual diferencia maiúsculas
    expect(val("5", "not_equals", "6")).toBe(true);
    expect(val("1e3", "equals", "1000")).toBe(false); // notação científica não é tratada como número
  });
  it("maior/menor comparam como número ('10' > '9', ao contrário do texto)", () => {
    expect(val("10", "greater", "9")).toBe(true);
    expect(val("-3", "less", "2")).toBe(true);
    expect(val("2.5", "greater", "2.49")).toBe(true);
    expect(val("5", "greater", "5")).toBe(false);
  });
  it("maior/menor com texto é erro claro, não comparação alfabética silenciosa", () => {
    const c = evaluateCondition("banana", "greater", "10");
    expect(c).toEqual({ ok: false, message: "“é maior que” exige números, mas recebeu “banana” e “10”." });
  });
  it("contém", () => {
    expect(val("relatorio-2026.pdf", "contains", ".pdf")).toBe(true);
    expect(val("abc", "contains", "x")).toBe(false);
    expect(val("abc", "contains", "")).toBe(true);
  });
  it("operador desconhecido", () => {
    expect(evaluateCondition("a", "parecido", "b")).toMatchObject({ ok: false });
  });
});

describe("coerceToDeclared", () => {
  it("sem declaração mantém o valor", () => {
    expect(coerceToDeclared("x", "texto", undefined)).toEqual({ ok: true, value: "texto" });
    expect(coerceToDeclared("x", 3, undefined)).toEqual({ ok: true, value: 3 });
  });
  it("número: aceita texto numérico, recusa o resto", () => {
    expect(coerceToDeclared("n", "42", "number")).toEqual({ ok: true, value: 42 });
    expect(coerceToDeclared("n", 7, "number")).toEqual({ ok: true, value: 7 });
    expect(coerceToDeclared("n", "abc", "number")).toMatchObject({ ok: false });
    expect(coerceToDeclared("n", "", "number")).toMatchObject({ ok: false });
    expect(coerceToDeclared("n", true, "number")).toMatchObject({ ok: false });
  });
  it("lógico e texto", () => {
    expect(coerceToDeclared("b", "true", "boolean")).toEqual({ ok: true, value: true });
    expect(coerceToDeclared("b", "false", "boolean")).toEqual({ ok: true, value: false });
    expect(coerceToDeclared("b", "sim", "boolean")).toMatchObject({ ok: false });
    expect(coerceToDeclared("s", 5, "string")).toEqual({ ok: true, value: "5" });
  });
});
