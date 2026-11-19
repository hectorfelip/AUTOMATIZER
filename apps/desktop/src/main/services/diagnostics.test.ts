import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDiagnostics } from "./diagnostics.js";

const PNG = Buffer.from("fake-png-bytes");
const setup = (capture: () => Promise<Buffer | null> = async () => PNG) => {
  const baseDir = mkdtempSync(join(tmpdir(), "as-diag-"));
  return { baseDir, d: createDiagnostics({ baseDir, capture, now: () => 1234 }) };
};

describe("diagnóstico por captura de tela", () => {
  it("salva dentro da pasta de diagnósticos, por execução, e consegue ler de volta", async () => {
    const { baseDir, d } = setup();
    const p = (await d.capture("exec-1", "mover"))!;
    expect(p).toBe(join(baseDir, "exec-1", "1234-mover.png"));
    expect(d.read(p)).toEqual(PNG);
  });

  it("nomes estranhos de execução/nó nunca escapam da pasta", async () => {
    const { baseDir, d } = setup();
    const p = (await d.capture("../../etc", "a/b\\c:d"))!;
    expect(p.startsWith(baseDir)).toBe(true);
    expect(readdirSync(baseDir)).toHaveLength(1); // uma única pasta, dentro de baseDir
    expect(p).not.toContain("..");
  });

  it("falha de captura (sem tela, sem permissão, exceção) devolve null e nunca lança", async () => {
    expect(await setup(async () => null).d.capture("e", "n")).toBeNull();
    expect(await setup(async () => Buffer.alloc(0)).d.capture("e", "n")).toBeNull();
    expect(await setup(async () => { throw new Error("sem permissão de tela"); }).d.capture("e", "n")).toBeNull();
  });

  it("read recusa caminho fora da pasta (travessia, absoluto, a própria pasta)", () => {
    const { baseDir, d } = setup();
    const outside = join(mkdtempSync(join(tmpdir(), "as-out-")), "segredo.txt");
    writeFileSync(outside, "segredo");
    expect(d.read(outside)).toBeNull();
    expect(d.read(join(baseDir, "..", "etc", "passwd"))).toBeNull();
    expect(d.read(join(baseDir, "x", "..", "..", outside.split("/").at(-2)!, "segredo.txt"))).toBeNull();
    expect(d.read(baseDir)).toBeNull();
    expect(d.read("/etc/passwd")).toBeNull();
    expect(d.read(join(baseDir, "nao-existe.png"))).toBeNull(); // dentro, mas inexistente
  });

  it("removeFiles apaga as capturas (e a pasta da execução quando esvazia) e ignora o que está fora", async () => {
    const { baseDir, d } = setup();
    const a = (await d.capture("e1", "a"))!;
    const outside = join(mkdtempSync(join(tmpdir(), "as-out-")), "importante.txt");
    writeFileSync(outside, "não apague");
    d.removeFiles([a, outside, join(baseDir, "nao-existe.png")]);
    expect(existsSync(a)).toBe(false);
    expect(existsSync(join(baseDir, "e1"))).toBe(false);
    expect(existsSync(outside)).toBe(true); // fora da pasta: intocado
  });

  it("pasta com outras capturas não é apagada", async () => {
    const { baseDir, d } = setup();
    mkdirSync(join(baseDir, "e1"), { recursive: true });
    writeFileSync(join(baseDir, "e1", "outra.png"), "x");
    const a = (await d.capture("e1", "a"))!;
    d.removeFiles([a]);
    expect(existsSync(join(baseDir, "e1", "outra.png"))).toBe(true);
  });
});
