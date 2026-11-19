import { useEffect, useState } from "react";
import type { RecordedStep } from "@automation-studio/shared-types";
import { Button } from "../../components/ui/Button";
import { errorMessage } from "../../lib/api";
import { useRecorder } from "../../stores/recorder";

const input = "rounded-md border border-line bg-bg px-2 py-1 text-sm text-fg";

function describe(s: RecordedStep): string {
  if (s.kind === "click")
    return `Clique ${s.button === "double" ? "duplo" : s.button === "right" ? "direito" : "esquerdo"} em (${s.x}, ${s.y})`;
  if (s.kind === "type")
    return s.sensitive ? "Digitar texto sensível (senha)" : "Digitar texto";
  if (s.kind === "hotkey") return `Atalho ${(s.keys ?? []).join("+")}`;
  return `Esperar ${s.seconds} s`;
}

function StepEditor({
  s,
  onChange,
}: {
  s: RecordedStep;
  onChange: (patch: Partial<RecordedStep>) => void;
}) {
  const num = (key: "x" | "y" | "seconds", label: string, min = 0) => (
    <label className="flex items-center gap-1 text-xs">
      {label}
      <input
        type="number"
        min={min}
        aria-label={`${label} do passo ${s.id}`}
        className={`${input} w-24`}
        value={s[key] ?? 0}
        onChange={(e) =>
          onChange({
            [key]: Math.max(min, Math.trunc(Number(e.target.value) || 0)),
          })
        }
      />
    </label>
  );
  if (s.kind === "click") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        {num("x", "X")}
        {num("y", "Y")}
        <select
          aria-label={`Botão do passo ${s.id}`}
          className={input}
          value={s.button}
          onChange={(e) =>
            onChange({ button: e.target.value as RecordedStep["button"] })
          }
        >
          <option value="left">Esquerdo</option>
          <option value="right">Direito</option>
          <option value="double">Duplo clique</option>
        </select>
      </div>
    );
  }
  if (s.kind === "type") {
    return s.sensitive ? (
      <p className="text-xs text-muted">
        Nada foi gravado desta digitação. O fluxo usará uma variável (
        <code>senha</code>) que você preenche depois no editor.
      </p>
    ) : (
      <input
        aria-label={`Texto do passo ${s.id}`}
        className={`${input} w-full`}
        value={s.text ?? ""}
        onChange={(e) => onChange({ text: e.target.value })}
      />
    );
  }
  if (s.kind === "hotkey") {
    return (
      <input
        aria-label={`Teclas do passo ${s.id}`}
        className={`${input} w-48`}
        value={(s.keys ?? []).join("+")}
        onChange={(e) =>
          onChange({
            keys: e.target.value
              .toLowerCase()
              .split("+")
              .map((k) => k.trim())
              .filter(Boolean),
          })
        }
      />
    );
  }
  return num("seconds", "Segundos", 1);
}

export function RecorderPage({
  onCreated,
}: {
  onCreated: (automationId: string) => void;
}) {
  const {
    status,
    steps,
    start,
    pause,
    stop,
    setSteps,
    create,
    discard,
    refresh,
  } = useRecorder();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("Minha gravação");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const patch = (id: string, p: Partial<RecordedStep>) =>
    setSteps((steps ?? []).map((s) => (s.id === id ? { ...s, ...p } : s)));
  const move = (i: number, d: -1 | 1) => {
    const a = [...(steps ?? [])];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j]!, a[i]!];
    setSteps(a);
  };

  // enquanto há gravação em curso, consulta o Main periodicamente: a tela converge mesmo se um push se perder
  useEffect(() => {
    if (status.state === "idle") return;
    const t = setInterval(() => void refresh().catch(() => undefined), 700);
    return () => clearInterval(t);
  }, [status.state, refresh]);

  // parou pelo atalho global (Ctrl+Alt+R) ou o processo terminou: busca os passos para revisão
  useEffect(() => {
    if (status.state === "stopping" && steps === null)
      void stop().catch((e) => setError(errorMessage(e)));
  }, [status.state, steps, stop]);

  const recording = status.state === "recording" || status.state === "starting";
  const review = steps !== null && !recording;

  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">Gravador</h1>
      {error && (
        <p
          role="alert"
          className="rounded-md border border-danger p-3 text-sm text-danger"
        >
          {error}
        </p>
      )}
      {status.notice && (
        <p role="status" className="rounded-md border border-line p-3 text-sm">
          {status.notice}
        </p>
      )}

      {!recording && !review && (
        <>
          <div className="rounded-lg border border-line bg-panel p-5 text-sm">
            <p>
              Grave o que você faz com o <strong>mouse e o teclado</strong> e
              transforme em um fluxo editável. Ao iniciar, este aplicativo é
              minimizado e uma <strong>faixa vermelha sempre visível</strong>{" "}
              mostra que está gravando.
            </p>
            <ul className="mt-2 list-disc pl-5 text-muted">
              <li>
                <kbd>Ctrl+Alt+R</kbd> para · <kbd>Ctrl+Alt+P</kbd> pausa/retoma
                · <kbd>Ctrl+Alt+S</kbd> liga/desliga o{" "}
                <strong>modo senha</strong> (as teclas desse trecho{" "}
                <strong>não são gravadas</strong>).
              </li>
              <li>
                Nada é salvo antes de você <strong>revisar</strong>. Cancelar
                apaga tudo da memória.
              </li>
              <li>
                Cliques viram posições na tela (frágeis com mudança de
                resolução/escala); prefira ativar a janela antes.
              </li>
              <li>
                Só no Windows. Requer <code>pynput</code> (
                <code>engine\python\requirements-recorder.txt</code>).
              </li>
            </ul>
          </div>
          <div>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => void run(start)}
            >
              Iniciar gravação
            </Button>
          </div>
        </>
      )}

      {recording && (
        <div
          className="flex flex-col gap-3 rounded-lg border border-danger p-5"
          data-testid="recording-panel"
        >
          <p className="font-medium text-danger" role="status">
            {status.state === "starting"
              ? "Iniciando…"
              : status.paused
                ? "⏸ Gravação pausada"
                : status.secret
                  ? "● Gravando — modo senha"
                  : "● Gravando"}
          </p>
          <p className="text-sm text-muted" data-testid="recording-count">
            {status.events} evento(s) capturado(s)
          </p>
          <div className="flex gap-2">
            <Button
              disabled={busy || status.state !== "recording"}
              onClick={() => void run(pause)}
            >
              {status.paused ? "Retomar" : "Pausar"}
            </Button>
            <Button
              variant="danger"
              disabled={busy || status.state !== "recording"}
              onClick={() => void run(stop)}
            >
              Parar e revisar
            </Button>
          </div>
        </div>
      )}

      {review && (
        <div className="flex flex-col gap-3" data-testid="review-panel">
          <p className="text-sm text-muted">
            Revise o que foi gravado: edite, apague ou reordene os passos. Só
            depois de “Criar automação” isto vira um fluxo (que{" "}
            <strong>não é executado</strong> sozinho).
          </p>
          {steps.length === 0 && (
            <p className="rounded-md border border-dashed border-line p-6 text-center text-muted">
              Nada foi gravado.
            </p>
          )}
          <ol className="flex flex-col gap-2" data-testid="steps">
            {steps.map((s, i) => (
              <li
                key={s.id}
                className="flex flex-col gap-2 rounded-lg border border-line bg-panel p-3"
                data-testid={`step-${s.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    {i + 1}. {describe(s)}
                  </span>
                  <span className="flex gap-1">
                    <Button
                      size="sm"
                      aria-label={`Subir passo ${s.id}`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </Button>
                    <Button
                      size="sm"
                      aria-label={`Descer passo ${s.id}`}
                      disabled={i === steps.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      aria-label={`Apagar passo ${s.id}`}
                      onClick={() =>
                        setSteps(steps.filter((x) => x.id !== s.id))
                      }
                    >
                      Apagar
                    </Button>
                  </span>
                </div>
                <StepEditor s={s} onChange={(p) => patch(s.id, p)} />
              </li>
            ))}
          </ol>
          <label className="flex max-w-md flex-col gap-1 text-sm">
            Nome da automação
            <input
              className={input}
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={busy || name.trim() === ""}
              onClick={() =>
                void run(async () => {
                  const a = await create(name.trim());
                  onCreated(a.id);
                })
              }
            >
              Criar automação
            </Button>
            <Button disabled={busy} onClick={() => void run(discard)}>
              Descartar gravação
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
