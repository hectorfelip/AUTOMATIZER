import { join } from "node:path";

export interface EngineLaunch {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface LaunchContext {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  isPackaged: boolean;
  /** Pasta de recursos do app empacotado (process.resourcesPath). */
  resourcesPath: string;
  /** Raiz do repositório (somente em desenvolvimento). */
  repoRoot: string;
}

/**
 * Como iniciar o motor. Ordem:
 *  1. AUTOMATION_STUDIO_ENGINE = executável do motor (usado para validar o empacotamento);
 *  2. app empacotado: executável em resources/engine (o usuário não precisa ter Python);
 *  3. desenvolvimento: `python -m automation_engine` (AUTOMATION_STUDIO_PYTHON, ou py/python/python3).
 */
export function resolveEngineLaunch(ctx: LaunchContext): EngineLaunch {
  const exe = ctx.platform === "win32" ? "automation-engine.exe" : "automation-engine";
  const override = ctx.env["AUTOMATION_STUDIO_ENGINE"];
  if (override) return { command: override, args: [] };
  if (ctx.isPackaged) return { command: join(ctx.resourcesPath, "engine", exe), args: [] };

  const engineDir = join(ctx.repoRoot, "engine", "python");
  const python = ctx.env["AUTOMATION_STUDIO_PYTHON"];
  const base = ["-m", "automation_engine"];
  const [command, args] = python
    ? [python, base]
    : ctx.platform === "win32"
      ? ["py", ["-3", ...base]] // launcher oficial do Windows: escolhe o Python 3 instalado
      : ["python3", base];
  const env: Record<string, string> = { PYTHONPATH: engineDir, PYTHONUNBUFFERED: "1", PYTHONIOENCODING: "utf-8" };
  const testActions = ctx.env["AUTOMATION_ENGINE_TEST_ACTIONS"];
  if (testActions) env["AUTOMATION_ENGINE_TEST_ACTIONS"] = testActions;
  return { command, args, cwd: engineDir, env };
}
