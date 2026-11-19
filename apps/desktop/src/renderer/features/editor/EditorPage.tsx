import { ReactFlowProvider } from "@xyflow/react";
import { useEffect, useState } from "react";
import { Button } from "../../components/ui/Button";
import { describeEngine, useEngine } from "../../stores/engine";
import { currentDoc, isDirty, issuesOf, useEditor } from "../../stores/editor";
import { usePlugins } from "../../stores/plugins";
import { useBreakpoints } from "../../stores/breakpoints";
import { useRun } from "../../stores/run";
import * as H from "./history";
import { getNodeDefinition } from "@automation-studio/node-registry";
import { duplicateNodes } from "./docOps";
import { FlowCanvas } from "./FlowCanvas";
import { ExecutionPanel } from "./ExecutionPanel";
import { IssuesPanel } from "./IssuesPanel";
import { NodePalette } from "./NodePalette";
import { RunFromDialog } from "./RunFromDialog";
import { PropertiesPanel } from "./PropertiesPanel";
import { VariablesPanel } from "./VariablesPanel";

type Tab = "props" | "vars" | "issues" | "run";

function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F9") {
        const st = useEditor.getState();
        const id = st.selectedNodes[0];
        if (id && st.automationId) {
          e.preventDefault();
          useBreakpoints.getState().toggle(st.automationId, id);
        }
        return;
      }
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const s = useEditor.getState();
      const key = e.key.toLowerCase();
      if (key === "s") {
        e.preventDefault();
        void s.save();
        return;
      }
      // Em campos de texto, Ctrl+Z/Y/D são do próprio campo.
      if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable=true]")) return;
      if (key === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (key === "y") {
        e.preventDefault();
        s.redo();
      } else if (key === "d") {
        e.preventDefault();
        const { doc, newIds } = duplicateNodes(s.history.present, s.selectedNodes);
        if (newIds.length) {
          s.commit(doc);
          s.select(newIds);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}

/** Fechar a janela com alterações não salvas: o Main (will-prevent-unload) pergunta ao usuário. */
function useUnloadGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
}

function Shell({ onBack }: { onBack: () => void }) {
  const doc = useEditor(currentDoc)!;
  const dirty = useEditor(isDirty);
  const { version, saving, saveError, history } = useEditor();
  const [tab, setTab] = useState<Tab>("props");
  const engine = describeEngine(useEngine((s) => s.status));
  const running = useRun((s) => s.running);
  const paused = useRun((s) => s.paused !== null);
  const [runFrom, setRunFrom] = useState<string | null>(null);
  const selectedId = useEditor((s) => s.selectedNodes[0] ?? null);
  const selectedCount = useEditor((s) => s.selectedNodes.length);
  const issues = issuesOf(doc);
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  useShortcuts();
  useUnloadGuard(dirty);
  const nodeIds = doc.nodes.map((n) => n.id).join("|");
  useEffect(() => {
    useBreakpoints.getState().prune(doc.id, nodeIds ? nodeIds.split("|") : []); // breakpoints de nós que não existem mais saem
  }, [doc.id, nodeIds]);
  useEffect(() => {
    if (selectedCount > 0) setTab("props");
  }, [selectedCount]);

  const status = dirty ? "● Alterações não salvas" : version > 0 ? `Salvo (versão ${version})` : "Ainda não salvo";
  const summary = issues.length === 0 ? "Fluxo válido" : [errors && `${errors} erro${errors > 1 ? "s" : ""}`, warnings && `${warnings} aviso${warnings > 1 ? "s" : ""}`].filter(Boolean).join(" · ");
  const tabs: [Tab, string][] = [["props", "Propriedades"], ["vars", "Variáveis"], ["issues", `Problemas (${issues.length})`], ["run", "Execução"]];
  const blocked = running ? "Já há uma execução em andamento." : errors > 0 ? "Corrija os erros do fluxo antes de executar." : !engine.ready ? `Motor ${engine.label.toLowerCase()}. ${engine.detail}` : "";
  const runFlow = (options?: Parameters<ReturnType<typeof useRun.getState>["start"]>[2]) => {
    setTab("run");
    const st = useEditor.getState();
    if (st.automationId) void useRun.getState().start(st.automationId, st.history.present, options);
  };
  const selectedNode = selectedId ? doc.nodes.find((n) => n.id === selectedId) : undefined;
  const selectedLabel = selectedNode ? (getNodeDefinition(selectedNode.type)?.label ?? selectedNode.type) : "";
  const canFrom = blocked === "" && selectedNode !== undefined && selectedNode.type !== "trigger.manual";

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <Button size="sm" onClick={onBack}>
          ← Automações
        </Button>
        <h1 className="truncate text-lg font-semibold">{doc.name}</h1>
        <span data-testid="save-status" className={`text-sm ${dirty ? "font-medium text-fg" : "text-muted"}`}>
          {status}
        </span>
        <span data-testid="validation-summary" className={`text-sm ${errors ? "text-danger" : "text-muted"}`}>
          {summary}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {saveError && (
            <span role="alert" className="text-sm text-danger">
              {saveError}
            </span>
          )}
          {running ? (
            <>
              {paused ? (
                <>
                  <Button size="sm" variant="primary" onClick={() => void useRun.getState().resume()}>
                    Continuar
                  </Button>
                  <Button size="sm" onClick={() => void useRun.getState().step()} title="Executa o nó seguinte e pausa de novo">
                    Próximo passo
                  </Button>
                </>
              ) : (
                <Button size="sm" onClick={() => void useRun.getState().pause()} title="A pausa vale ao fim do nó em andamento">
                  Pausar
                </Button>
              )}
              <Button size="sm" variant="danger" onClick={() => void useRun.getState().cancel()}>
                Cancelar
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="primary" disabled={blocked !== ""} title={blocked || "Executar o fluxo como está na tela"} onClick={() => runFlow()}>
                Executar
              </Button>
              <Button size="sm" disabled={blocked !== ""} title={blocked || "Executar pausando antes de cada nó"} onClick={() => runFlow({ mode: "step" })}>
                Passo a passo
              </Button>
              <Button size="sm" disabled={!canFrom} title={canFrom ? "Executar a partir do nó selecionado" : blocked || "Selecione um nó (que não seja o início) para executar a partir dele"} onClick={() => setRunFrom(selectedId)}>
                Executar a partir daqui
              </Button>
            </>
          )}
          <Button size="sm" disabled={!H.canUndo(history)} onClick={() => useEditor.getState().undo()} title="Desfazer (Ctrl+Z)">
            Desfazer
          </Button>
          <Button size="sm" disabled={!H.canRedo(history)} onClick={() => useEditor.getState().redo()} title="Refazer (Ctrl+Y)">
            Refazer
          </Button>
          <Button size="sm" variant="primary" disabled={!dirty || saving} onClick={() => void useEditor.getState().save()} title="Salvar (Ctrl+S)">
            {saving ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <NodePalette />
        <div className="relative min-w-0 flex-1">
          <div className="absolute inset-0">
            <FlowCanvas />
          </div>
        </div>
        <aside aria-label="Painel lateral" className="flex w-[22rem] shrink-0 flex-col border-l border-line bg-panel">
          <div role="tablist" className="flex border-b border-line">
            {tabs.map(([id, label]) => (
              <button
                key={id}
                role="tab"
                type="button"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`flex-1 whitespace-nowrap px-1 py-2 text-[13px] font-medium ${tab === id ? "border-b-2 border-brand" : "text-muted"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" className="min-h-0 flex-1 overflow-auto p-4">
            {tab === "props" && <PropertiesPanel />}
            {tab === "vars" && <VariablesPanel />}
            {tab === "issues" && <IssuesPanel onGoToNode={() => setTab("props")} />}
            {tab === "run" && <ExecutionPanel />}
          </div>
        </aside>
      </div>
      <RunFromDialog
        doc={doc}
        nodeId={runFrom}
        nodeLabel={selectedLabel}
        onClose={() => setRunFrom(null)}
        onRun={(variables) => {
          const fromNodeId = runFrom;
          setRunFrom(null);
          if (fromNodeId) runFlow({ mode: "from", fromNodeId, variables });
        }}
      />
    </div>
  );
}

export function EditorPage({ automationId, onBack }: { automationId: string; onBack: () => void }) {
  const pluginsReady = usePlugins((s) => s.ready);
  const status = useEditor((s) => s.status);
  const loadError = useEditor((s) => s.loadError);

  useEffect(() => {
    void useEditor.getState().open(automationId);
    return () => useEditor.getState().close();
  }, [automationId]);

  if (status === "error") {
    return (
      <div className="flex flex-col items-start gap-3 p-8">
        <p role="alert" className="text-danger">
          {loadError}
        </p>
        <div className="flex gap-2">
          <Button onClick={onBack}>← Automações</Button>
          <Button onClick={() => void useEditor.getState().open(automationId)}>Tentar novamente</Button>
        </div>
      </div>
    );
  }
  if (status !== "ready" || !pluginsReady) return <p className="p-8 text-muted">Carregando fluxo…</p>;
  return (
    <ReactFlowProvider>
      <Shell onBack={onBack} />
    </ReactFlowProvider>
  );
}
