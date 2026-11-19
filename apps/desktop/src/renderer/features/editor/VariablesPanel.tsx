import type { VariableType } from "@automation-studio/workflow-schema";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { currentDoc, useEditor } from "../../stores/editor";
import { addVariable, convertVariableValue, removeVariable, renameVariable, setFlowSettings, setVariable } from "./docOps";

const input = "w-full rounded-md border border-line bg-bg px-2 py-1 text-sm text-fg";

/** O nome só é aplicado ao sair do campo: renomear a cada tecla geraria nomes inválidos/duplicados no meio do caminho. */
function NameInput({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const apply = () => {
    const s = useEditor.getState();
    const res = renameVariable(s.history.present, name, draft);
    if (typeof res === "string") {
      setError(res);
      return;
    }
    setError(null);
    s.commit(res);
  };
  return (
    <div>
      <input
        aria-label={`Nome da variável ${name}`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        aria-invalid={error ? true : undefined}
        className={input}
      />
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

export function VariablesPanel() {
  const doc = useEditor(currentDoc)!;
  const commit = useEditor.getState().commit;
  const entries = Object.entries(doc.variables);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        Use nos parâmetros como <code>{"{{variables.nome}}"}</code>.
      </p>
      {entries.length === 0 && <p className="text-sm text-muted">Nenhuma variável.</p>}
      {entries.map(([name, v]) => (
        <div key={name} className="flex flex-col gap-1 rounded-md border border-line p-2">
          <NameInput key={name} name={name} />
          <div className="flex gap-2">
            <select
              aria-label={`Tipo de ${name}`}
              value={v.type}
              onChange={(e) => {
                const type = e.target.value as VariableType;
                commit(setVariable(doc, name, { type, value: convertVariableValue(v.value, type) }));
              }}
              className={`${input} w-28`}
            >
              <option value="string">texto</option>
              <option value="number">número</option>
              <option value="boolean">lógico</option>
            </select>
            {v.type === "boolean" ? (
              <input type="checkbox" aria-label={`Valor de ${name}`} checked={v.value === true} onChange={(e) => commit(setVariable(doc, name, { type: v.type, value: e.target.checked }))} className="h-4 w-4 self-center" />
            ) : (
              <input
                aria-label={`Valor de ${name}`}
                value={String(v.value)}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  const value = v.type === "number" ? (e.target.value.trim() !== "" && Number.isFinite(n) ? n : v.value) : e.target.value;
                  commit(setVariable(doc, name, { type: v.type, value }), `var:${name}`);
                }}
                className={input}
              />
            )}
            <Button size="sm" aria-label={`Remover variável ${name}`} onClick={() => commit(removeVariable(doc, name))}>
              ✕
            </Button>
          </div>
        </div>
      ))}
      <Button size="sm" onClick={() => commit(addVariable(doc))}>
        Adicionar variável
      </Button>
      <fieldset className="mt-2 flex flex-col gap-2 border-t border-line pt-3">
        <legend className="text-sm font-medium">Execução do fluxo</legend>
        <label className="flex flex-col gap-1 text-sm">
          Tempo limite (segundos)
          <input
            type="number"
            min={1}
            max={86400}
            aria-label="Tempo limite do fluxo (segundos)"
            value={doc.settings.timeoutSeconds}
            onChange={(e) => commit(setFlowSettings(doc, { timeoutSeconds: Math.trunc(Number(e.target.value)) }), "flow:timeout")}
            className={input}
          />
          <span className="text-xs text-muted">O tempo em que a execução está pausada não conta.</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Quando um nó falha
          <select
            aria-label="Política de erro do fluxo"
            value={doc.settings.errorPolicy}
            onChange={(e) => commit(setFlowSettings(doc, { errorPolicy: e.target.value as "stop" | "continue" }))}
            className={input}
          >
            <option value="stop">Parar a execução</option>
            <option value="continue">Continuar pelo caminho normal (termina “com avisos”)</option>
          </select>
          <span className="text-xs text-muted">Falhas do motor, tempo esgotado e configuração inválida sempre param. Um nó com saída “Erro” ligada segue por ela, qualquer que seja a política.</span>
        </label>
      </fieldset>
    </div>
  );
}
