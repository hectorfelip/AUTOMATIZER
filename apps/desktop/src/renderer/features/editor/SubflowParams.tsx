import type { ConfigField } from "@automation-studio/node-registry";
import type { WorkflowNode } from "@automation-studio/workflow-schema";
import type { AvailableRefs } from "@automation-studio/workflow-validator";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { errorMessage, unwrap } from "../../lib/api";
import { useEditor } from "../../stores/editor";
import { updateNodeConfig } from "./docOps";
import { FieldInput } from "./FieldInput";

type Vars = Record<string, { type: string; value: string | number | boolean }>;

/** Parâmetros e retorno de "Chamar fluxo": as variáveis do fluxo escolhido (versão salva) são a interface dele. */
export function SubflowParams({ node, refs, errors }: { node: WorkflowNode; refs: AvailableRefs | undefined; errors: Record<string, string> }) {
  const targetId = typeof node.config["automationId"] === "string" ? node.config["automationId"] : "";
  const [state, setState] = useState<{ id: string; vars: Vars } | { id: string; error: string } | null>(null);

  useEffect(() => {
    if (!targetId) return;
    let alive = true;
    unwrap((a) => a.workflows.load({ automationId: targetId })).then(
      (r) => alive && setState({ id: targetId, vars: r.document.variables as Vars }),
      (e) => alive && setState({ id: targetId, error: errorMessage(e) }),
    );
    return () => {
      alive = false;
    };
  }, [targetId]);

  if (!targetId) return <p className="text-xs text-muted">Escolha o fluxo para ver os parâmetros.</p>;
  if (!state || state.id !== targetId) return <p className="text-xs text-muted">Carregando parâmetros…</p>;
  if ("error" in state) {
    return (
      <p role="alert" className="text-xs text-danger">
        {state.error}
      </p>
    );
  }

  const names = Object.keys(state.vars);
  const commit = (key: string, value: string) => {
    const s = useEditor.getState();
    s.commit(updateNodeConfig(s.history.present, node.id, key, value), `cfg:${node.id}:${key}`);
  };
  const stale = Object.keys(node.config).filter((k) => k.startsWith("arg.") && !names.includes(k.slice(4)));

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line p-3" data-testid="subflow-params">
      <legend className="px-1 text-sm font-medium">Parâmetros</legend>
      {names.length === 0 && <p className="text-xs text-muted">O fluxo escolhido não tem variáveis; não há o que passar.</p>}
      {names.map((name) => {
        const v = state.vars[name]!;
        const key = `arg.${name}`;
        const field: ConfigField = { key, label: name, kind: "text", help: `${v.type === "string" ? "texto" : v.type === "number" ? "número" : "lógico"} · vazio mantém o padrão (${String(v.value) || "vazio"})` };
        const raw = node.config[key];
        return <FieldInput key={key} field={field} value={raw} refs={refs} error={errors[key]} onChange={(val) => commit(key, String(val ?? ""))} />;
      })}
      {stale.map((k) => (
        <div key={k} className="flex items-center justify-between gap-2 text-xs text-danger">
          <span>“{k.slice(4)}” não existe mais no fluxo chamado.</span>
          <Button
            size="sm"
            onClick={() => {
              const s = useEditor.getState();
              const doc = s.history.present;
              s.commit({ ...doc, nodes: doc.nodes.map((n) => (n.id === node.id ? { ...n, config: Object.fromEntries(Object.entries(n.config).filter(([ck]) => ck !== k)) } : n)) });
            }}
          >
            Remover
          </Button>
        </div>
      ))}
      <p className="text-xs text-muted" data-testid="subflow-returns">
        Volta ao terminar: {names.length ? names.map((n) => `{{nodes.${node.id}.outputs.${n}}}`).join(", ") : "nada (o fluxo não tem variáveis)"}.
      </p>
    </fieldset>
  );
}
