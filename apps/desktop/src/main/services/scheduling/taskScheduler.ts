import type { ScheduleConfig } from "@automation-studio/shared-types";
import { parseLocal } from "./nextRun.js";

/** Executa um programa SEM shell e devolve a saída. Em produção é `execFile`; nos testes, um dublê. */
export type RunCommand = (file: string, args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export interface TaskSpec {
  /** Nome da tarefa no Windows. Só caracteres seguros (vem de um UUID gerado por nós). */
  name: string;
  /** Executável do app e argumentos fixos (ex.: `--run-automation=<id> --schedule=<id>`). */
  command: string;
  args: string[];
  config: ScheduleConfig;
  enabled: boolean;
}

const SAFE_NAME = /^[A-Za-z0-9_-]{1,100}$/;
const SAFE_ARG = /^--[a-z-]+=[A-Za-z0-9_-]{1,100}$/;

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
const pad = (n: number) => String(n).padStart(2, "0");
/** Data/hora local no formato do Agendador (sem fuso: a tarefa vale no relógio do computador). */
const stamp = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function trigger(c: ScheduleConfig, startBoundary: Date): string {
  switch (c.kind) {
    case "once": {
      const t = parseLocal(c.at);
      if (!t) throw new Error("Data inválida.");
      return `<TimeTrigger><StartBoundary>${stamp(t)}</StartBoundary><Enabled>true</Enabled></TimeTrigger>`;
    }
    case "daily":
      return `<CalendarTrigger><StartBoundary>${stamp(startBoundary)}</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`;
    case "weekly":
      return `<CalendarTrigger><StartBoundary>${stamp(startBoundary)}</StartBoundary><Enabled>true</Enabled><ScheduleByWeek><WeeksInterval>1</WeeksInterval><DaysOfWeek>${[...c.days].sort().map((d) => `<${DAYS[d]} />`).join("")}</DaysOfWeek></ScheduleByWeek></CalendarTrigger>`;
    case "logon":
      return "<LogonTrigger><Enabled>true</Enabled></LogonTrigger>";
  }
}

/**
 * XML da tarefa (esquema 1.2). Decisões que importam:
 * - `InteractiveToken` + `LeastPrivilege`: roda na sessão do usuário, sem elevar — automação de tela só existe em sessão interativa;
 * - `StartWhenAvailable`: se o computador estava desligado na hora, roda assim que possível;
 * - `IgnoreNew`: nunca duas execuções ao mesmo tempo (o app também recusa).
 */
export function buildTaskXml(spec: TaskSpec, now: Date = new Date()): string {
  if (!SAFE_NAME.test(spec.name)) throw new Error("Nome de tarefa inválido.");
  if (spec.args.some((a) => !SAFE_ARG.test(a))) throw new Error("Argumento de tarefa inválido.");
  const startBoundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
  if (spec.config.kind === "daily" || spec.config.kind === "weekly") {
    const [h, m] = spec.config.time.split(":").map(Number) as [number, number];
    startBoundary.setHours(h, m, 0, 0);
  }
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>Automation Studio — agendamento</Description></RegistrationInfo>
  <Triggers>${trigger(spec.config, startBoundary)}</Triggers>
  <Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <Enabled>${spec.enabled}</Enabled>
    <ExecutionTimeLimit>PT24H</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Author"><Exec><Command>${xml(spec.command)}</Command><Arguments>${xml(spec.args.join(" "))}</Arguments></Exec></Actions>
</Task>
`;
}

export interface TaskSchedulerDeps {
  platform: NodeJS.Platform;
  run: RunCommand;
  /** Grava o XML em arquivo temporário e devolve o caminho (e como apagar). */
  writeTemp(name: string, content: string): { path: string; cleanup(): void };
}

export interface TaskResult {
  ok: boolean;
  /** Mensagem segura para a interface. */
  message?: string;
}

const FOLDER = "AutomationStudio";

/** Fala com o `schtasks.exe`. Fora do Windows devolve "unsupported" em vez de fingir que agendou. */
export function createTaskScheduler({ platform, run, writeTemp }: TaskSchedulerDeps) {
  const supported = platform === "win32";
  const unsupported: TaskResult = { ok: false, message: "O agendamento só é registrado no Windows, com o aplicativo instalado (não em Linux nem no modo de desenvolvimento). Ele fica salvo, mas não será disparado neste computador." };
  const full = (name: string) => `${FOLDER}\\${name}`;
  const fail = (what: string, r: { code: number; stderr: string; stdout: string }): TaskResult => {
    const detail = (r.stderr || r.stdout).trim().split(/\r?\n/)[0] ?? "";
    return { ok: false, message: `${what}${detail ? ` (${detail.slice(0, 200)})` : ""}` };
  };

  return {
    supported,

    /** Cria ou substitui a tarefa. */
    async upsert(spec: TaskSpec): Promise<TaskResult> {
      if (!supported) return unsupported;
      const tmp = writeTemp(spec.name, buildTaskXml(spec));
      try {
        const r = await run("schtasks.exe", ["/Create", "/TN", full(spec.name), "/XML", tmp.path, "/F"]);
        return r.code === 0 ? { ok: true } : fail("O Windows recusou o agendamento. Verifique as permissões do Agendador de Tarefas", r);
      } catch {
        return { ok: false, message: "Não foi possível falar com o Agendador de Tarefas do Windows." };
      } finally {
        tmp.cleanup();
      }
    },

    /** Remove a tarefa; "não existe" conta como sucesso (a intenção é que ela não exista). */
    async remove(name: string): Promise<TaskResult> {
      if (!supported) return { ok: true };
      if (!SAFE_NAME.test(name)) return { ok: false, message: "Nome de tarefa inválido." };
      try {
        const r = await run("schtasks.exe", ["/Delete", "/TN", full(name), "/F"]);
        if (r.code === 0) return { ok: true };
        const q = await run("schtasks.exe", ["/Query", "/TN", full(name)]);
        return q.code !== 0 ? { ok: true } : fail("Não foi possível remover a tarefa do Windows", r);
      } catch {
        return { ok: false, message: "Não foi possível falar com o Agendador de Tarefas do Windows." };
      }
    },
  };
}
export type TaskScheduler = ReturnType<typeof createTaskScheduler>;
