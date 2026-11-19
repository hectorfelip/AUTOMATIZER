import { describe, expect, it } from "vitest";
import { configProblem, nextRun, parseLocal } from "./nextRun.js";

const d = (s: string) => new Date(s); // "2026-03-10T10:00:00" = horário local
const iso = (x: Date | null) => (x ? `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")} ${String(x.getHours()).padStart(2, "0")}:${String(x.getMinutes()).padStart(2, "0")}` : null);

describe("nextRun", () => {
  const from = d("2026-03-10T10:00:00"); // terça

  it("única: só se estiver no futuro", () => {
    expect(iso(nextRun({ kind: "once", at: "2026-03-10T10:01" }, from))).toBe("2026-03-10 10:01");
    expect(nextRun({ kind: "once", at: "2026-03-10T10:00" }, from)).toBeNull(); // igual a agora = já passou
    expect(nextRun({ kind: "once", at: "2026-03-09T23:59" }, from)).toBeNull();
  });
  it("diária: hoje se ainda não passou, senão amanhã (e vira o mês/ano)", () => {
    expect(iso(nextRun({ kind: "daily", time: "10:30" }, from))).toBe("2026-03-10 10:30");
    expect(iso(nextRun({ kind: "daily", time: "10:00" }, from))).toBe("2026-03-11 10:00");
    expect(iso(nextRun({ kind: "daily", time: "08:00" }, d("2026-12-31T09:00:00")))).toBe("2027-01-01 08:00");
  });
  it("semanal: o próximo dia marcado, inclusive hoje e a semana seguinte", () => {
    expect(iso(nextRun({ kind: "weekly", time: "11:00", days: [2] }, from))).toBe("2026-03-10 11:00"); // hoje (terça), ainda não deu
    expect(iso(nextRun({ kind: "weekly", time: "09:00", days: [2] }, from))).toBe("2026-03-17 09:00"); // hoje já passou → próxima terça
    expect(iso(nextRun({ kind: "weekly", time: "09:00", days: [0, 5] }, from))).toBe("2026-03-13 09:00"); // sexta
    expect(iso(nextRun({ kind: "weekly", time: "09:00", days: [1] }, from))).toBe("2026-03-16 09:00"); // segunda
  });
  it("'ao entrar no Windows' não tem próxima data", () => {
    expect(nextRun({ kind: "logon" }, from)).toBeNull();
  });
});

describe("configProblem", () => {
  const now = d("2026-03-10T10:00:00");
  it.each([
    [{ kind: "once", at: "2026-03-10T11:00" }, null],
    [{ kind: "once", at: "2026-03-10T09:00" }, /futuro/],
    [{ kind: "once", at: "2026-02-31T09:00" }, /válidas/],
    [{ kind: "once", at: "amanhã" }, /válidas/],
    [{ kind: "daily", time: "07:30" }, null],
    [{ kind: "daily", time: "24:00" }, /HH:MM/],
    [{ kind: "daily", time: "7:30" }, /HH:MM/],
    [{ kind: "weekly", time: "07:30", days: [1, 3] }, null],
    [{ kind: "weekly", time: "07:30", days: [] }, /dia da semana/],
    [{ kind: "weekly", time: "07:30", days: [7] }, /dia da semana/],
    [{ kind: "weekly", time: "07:30", days: [1, 1] }, /dia da semana/],
    [{ kind: "logon" }, null],
  ] as const)("%j", (cfg, expected) => {
    const r = configProblem(cfg as never, now);
    if (expected === null) expect(r).toBeNull();
    else expect(r).toMatch(expected);
  });
  it("parseLocal recusa datas inexistentes", () => {
    expect(parseLocal("2026-02-30T10:00")).toBeNull();
    expect(parseLocal("2026-02-28T10:00")).not.toBeNull();
  });
});
