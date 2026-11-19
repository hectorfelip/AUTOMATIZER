import { mkdirSync, readFileSync, rmdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

export interface DiagnosticsDeps {
  /** Pasta onde as capturas ficam (dentro dos dados do usuário). */
  baseDir: string;
  /** Captura a tela como PNG; null se não houver como (nunca lança para quem chama). */
  capture: () => Promise<Buffer | null>;
  now?: () => number;
}

/** Capturas de tela de diagnóstico: opcionais, locais e sempre dentro de `baseDir`. */
export function createDiagnostics({ baseDir, capture, now = Date.now }: DiagnosticsDeps) {
  const root = resolve(baseDir);
  const inside = (p: string): boolean => {
    const rel = relative(root, resolve(p));
    return rel !== "" && !rel.startsWith("..") && !rel.includes(`..${sep}`) && resolve(root, rel) === resolve(p);
  };
  const safeName = (s: string): string => s.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 60);

  return {
    /** Salva a captura e devolve o caminho; null se não foi possível (a execução não é afetada). */
    async capture(executionId: string, nodeId: string): Promise<string | null> {
      try {
        const png = await capture();
        if (!png || png.length === 0) return null;
        const file = join(root, safeName(executionId), `${now()}-${safeName(nodeId)}.png`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, png);
        return file;
      } catch {
        return null;
      }
    },

    /** Lê uma captura. Recusa qualquer caminho fora de `baseDir` (o caminho vem do banco, mas nunca confiamos). */
    read(path: string): Buffer | null {
      if (!inside(path)) return null;
      try {
        return readFileSync(path);
      } catch {
        return null;
      }
    },

    /** Apaga capturas; ignora o que estiver fora de `baseDir` ou já não existir. */
    removeFiles(paths: string[]): void {
      for (const p of paths) {
        if (!inside(p)) continue;
        try {
          rmSync(p, { force: true });
          const dir = dirname(p);
          if (inside(dir)) rmdirSync(dir); // remove a pasta da execução só se ficou vazia (senão lança e fica)
        } catch {
          /* pasta com outras capturas: fica */
        }
      }
    },
  };
}
export type Diagnostics = ReturnType<typeof createDiagnostics>;
