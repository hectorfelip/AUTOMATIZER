import { describe, expect, it } from "vitest";
import { buildTaskXml, createTaskScheduler, type RunCommand } from "./taskScheduler.js";

const base = { name: "sch-1", command: "C:\\Program Files\\Automation Studio\\Automation Studio.exe", args: ["--run-automation=abc-123", "--schedule=sch-1"], enabled: true };
const now = new Date(2026, 2, 10, 10, 0);

describe("buildTaskXml", () => {
  it("única: TimeTrigger na data local", () => {
    const x = buildTaskXml({ ...base, config: { kind: "once", at: "2026-03-12T14:30" } }, now);
    expect(x).toContain("<TimeTrigger><StartBoundary>2026-03-12T14:30:00</StartBoundary>");
    expect(x).not.toContain("CalendarTrigger");
  });
  it("diária: ScheduleByDay com a hora", () => {
    const x = buildTaskXml({ ...base, config: { kind: "daily", time: "07:05" } }, now);
    expect(x).toContain("<StartBoundary>2026-03-10T07:05:00</StartBoundary>");
    expect(x).toContain("<ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>");
  });
  it("semanal: dias na ordem", () => {
    const x = buildTaskXml({ ...base, config: { kind: "weekly", time: "18:00", days: [5, 1] } }, now);
    expect(x).toContain("<DaysOfWeek><Monday /><Friday /></DaysOfWeek>");
  });
  it("ao entrar: LogonTrigger", () => {
    expect(buildTaskXml({ ...base, config: { kind: "logon" } }, now)).toContain("<LogonTrigger>");
  });
  it("sessão interativa, sem elevar, recupera execução perdida e nunca duplica", () => {
    const x = buildTaskXml({ ...base, config: { kind: "logon" } }, now);
    expect(x).toContain("<LogonType>InteractiveToken</LogonType>");
    expect(x).toContain("<RunLevel>LeastPrivilege</RunLevel>");
    expect(x).toContain("<StartWhenAvailable>true</StartWhenAvailable>");
    expect(x).toContain("<MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>");
  });
  it("desativado vai no XML; caminho com & e espaços é escapado", () => {
    const x = buildTaskXml({ ...base, command: "C:\\A & B\\app.exe", enabled: false, config: { kind: "logon" } }, now);
    expect(x).toContain("<Enabled>false</Enabled>");
    expect(x).toContain("<Command>C:\\A &amp; B\\app.exe</Command>");
  });
  it("recusa nome e argumentos fora da lista segura (sem injeção)", () => {
    const cfg = { kind: "logon" } as const;
    expect(() => buildTaskXml({ ...base, name: "x; calc", config: cfg }, now)).toThrow();
    expect(() => buildTaskXml({ ...base, name: "a\\b", config: cfg }, now)).toThrow();
    expect(() => buildTaskXml({ ...base, args: ["--run-automation=a b"], config: cfg }, now)).toThrow();
    expect(() => buildTaskXml({ ...base, args: ["--run-automation=a&calc"], config: cfg }, now)).toThrow();
    expect(() => buildTaskXml({ ...base, args: ["calc.exe"], config: cfg }, now)).toThrow();
  });
});

describe("createTaskScheduler", () => {
  const mk = (platform: NodeJS.Platform, run: RunCommand) => {
    const written: string[] = [];
    let cleaned = 0;
    const ts = createTaskScheduler({
      platform,
      run,
      writeTemp: (name, content) => (written.push(content), { path: `C:\\tmp\\${name}.xml`, cleanup: () => void cleaned++ }),
    });
    return { ts, written, cleaned: () => cleaned };
  };
  const spec = { ...base, config: { kind: "daily", time: "07:00" } as const };

  it("fora do Windows não finge: devolve 'unsupported' e não executa nada", async () => {
    const calls: string[][] = [];
    const { ts } = mk("linux", async (_f, a) => (calls.push(a), { code: 0, stdout: "", stderr: "" }));
    expect(await ts.upsert(spec)).toMatchObject({ ok: false, message: expect.stringContaining("só é registrado no Windows") });
    expect(await ts.remove("sch-1")).toEqual({ ok: true });
    expect(calls).toHaveLength(0);
  });

  it("Windows: chama schtasks sem shell com argumentos separados, usa a pasta própria e apaga o XML temporário", async () => {
    const calls: [string, string[]][] = [];
    const { ts, written, cleaned } = mk("win32", async (f, a) => (calls.push([f, a]), { code: 0, stdout: "", stderr: "" }));
    expect(await ts.upsert(spec)).toEqual({ ok: true });
    expect(calls[0]).toEqual(["schtasks.exe", ["/Create", "/TN", "AutomationStudio\\sch-1", "/XML", "C:\\tmp\\sch-1.xml", "/F"]]);
    expect(written[0]).toContain("ScheduleByDay");
    expect(cleaned()).toBe(1);
  });

  it("falha do schtasks vira mensagem clara (sem despejar a saída inteira) e ainda limpa o temporário", async () => {
    const { ts, cleaned } = mk("win32", async () => ({ code: 1, stdout: "", stderr: "ERRO: Acesso negado.\nmais linhas\n" + "x".repeat(500) }));
    const r = await ts.upsert(spec);
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Acesso negado");
    expect(r.message).not.toContain("mais linhas");
    expect(cleaned()).toBe(1);
  });

  it("não conseguir executar o schtasks não derruba o app", async () => {
    const { ts } = mk("win32", async () => {
      throw new Error("ENOENT");
    });
    expect(await ts.upsert(spec)).toMatchObject({ ok: false, message: expect.stringContaining("Agendador de Tarefas") });
    expect(await ts.remove("sch-1")).toMatchObject({ ok: false });
  });

  it("remover tarefa que já não existe conta como sucesso; falha real com a tarefa presente, não", async () => {
    let queryCode = 1;
    const { ts } = mk("win32", async (_f, a) => (a[0] === "/Delete" ? { code: 1, stdout: "", stderr: "não encontrada" } : { code: queryCode, stdout: "", stderr: "" }));
    expect(await ts.remove("sch-1")).toEqual({ ok: true });
    queryCode = 0;
    expect(await ts.remove("sch-1")).toMatchObject({ ok: false });
    expect(await ts.remove("../x")).toMatchObject({ ok: false });
  });
});
