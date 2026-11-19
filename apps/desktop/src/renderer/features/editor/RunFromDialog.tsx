import type { WorkflowDocument } from "@automation-studio/workflow-schema";
import { useState } from "react";
import { Button } from "../../components/ui/Button";
import { Dialog } from "../../components/ui/Dialog";

interface Props {
  doc: WorkflowDocument;
  nodeId: string | null;
  nodeLabel: string;
  onClose: () => void;
  onRun: (variables: Record<string, string | number | boolean>) => void;
}

/** "Executar a partir daqui": o contexto começa vazio (sem resultados de nós anteriores); só as variáveis podem ser definidas. */
export function RunFromDialog({ doc, nodeId, nodeLabel, onClose, onRun }: Props) {
  const names = Object.keys(doc.variables);
  const [values, setValues] = useState<Record<string, string>>({});
  const usesResults = JSON.stringify(doc.nodes.map((n) => n.config)).includes("{{nodes.");
  const submit = () => {
    const out: Record<string, string | number | boolean> = {};
    for (const [k, raw] of Object.entries(values)) {
      if (raw === "") continue; // vazio = manter o valor do fluxo
      const t = doc.variables[k]!.type;
      out[k] = t === "number" ? Number(raw) : t === "boolean" ? raw === "true" : raw;
    }
    onRun(out);
  };
  const invalid = names.some((k) => doc.variables[k]!.type === "number" && values[k] && Number.isNaN(Number(values[k])));
  return (
    <Dialog open={nodeId !== null} title={`Executar a partir de “${nodeLabel}”`} onClose={onClose}>
      <p className="text-sm text-muted">A execução começa neste nó, sem rodar os anteriores. Resultados de nós anteriores não existem neste contexto.</p>
      {usesResults && (
        <p role="note" className="rounded-md border border-line p-2 text-sm" data-testid="runfrom-warning">
          Este fluxo usa resultados de outros nós ({"{{nodes.…}}"}). Se o caminho passar por eles sem terem rodado, o nó vai falhar apontando o que falta.
        </p>
      )}
      {names.length > 0 && (
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">Valores iniciais das variáveis (opcional)</p>
          {names.map((k) => (
            <label key={k} className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0 truncate font-mono">{k}</span>
              <input
                className="w-full rounded-md border border-line bg-bg px-2 py-1 text-fg"
                placeholder={`padrão: ${String(doc.variables[k]!.value)}`}
                value={values[k] ?? ""}
                onChange={(e) => setValues({ ...values, [k]: e.target.value })}
                aria-label={`Valor inicial de ${k}`}
              />
            </label>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button variant="primary" disabled={invalid} onClick={submit}>
          Executar a partir daqui
        </Button>
      </div>
    </Dialog>
  );
}
