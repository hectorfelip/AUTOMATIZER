import { getNodeDefinition } from "@automation-studio/node-registry";
import { Button } from "../../components/ui/Button";
import { currentDoc, issuesOf, useEditor } from "../../stores/editor";
import { duplicateNodes, removeNodes, updateNodeConfig } from "./docOps";
import { FieldInput } from "./FieldInput";

export function PropertiesPanel() {
  const doc = useEditor(currentDoc)!;
  const selected = useEditor((s) => s.selectedNodes).filter((id) => doc.nodes.some((n) => n.id === id));
  const issues = issuesOf(doc);

  const duplicate = () => {
    const { doc: next, newIds } = duplicateNodes(doc, selected);
    if (newIds.length === 0) return;
    useEditor.getState().commit(next);
    useEditor.getState().select(newIds);
  };
  const remove = () => {
    useEditor.getState().commit(removeNodes(doc, selected));
    useEditor.getState().select([]);
  };

  if (selected.length === 0) {
    return <p className="text-sm text-muted">Selecione um nó no canvas para editar seus parâmetros.</p>;
  }

  const actions = (
    <div className="flex gap-2">
      <Button size="sm" onClick={duplicate}>
        Duplicar
      </Button>
      <Button size="sm" variant="danger" onClick={remove}>
        Excluir
      </Button>
    </div>
  );

  if (selected.length > 1) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm">{selected.length} nós selecionados.</p>
        {actions}
      </div>
    );
  }

  const node = doc.nodes.find((n) => n.id === selected[0])!;
  const def = getNodeDefinition(node.type);
  if (!def) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm text-danger">
          Tipo de nó desconhecido: {node.type}.
        </p>
        {actions}
      </div>
    );
  }
  const mine = issues.filter((i) => i.nodeId === node.id);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="font-semibold">{def.label}</h3>
        <p className="text-xs text-muted">{def.description}</p>
        <p className="mt-1 text-xs text-muted">ID: {node.id}</p>
      </div>
      {mine.filter((i) => !i.field).map((i, k) => (
        <p key={k} role="alert" className="text-sm text-danger">
          {i.message}
        </p>
      ))}
      {def.fields.length === 0 && <p className="text-sm text-muted">Este nó não tem parâmetros.</p>}
      {def.fields.map((f) => (
        <FieldInput
          key={`${node.id}:${f.key}`}
          field={f}
          value={node.config[f.key]}
          error={mine.find((i) => i.field === f.key)?.message.replace(`${def.label}: `, "")}
          onChange={(v) => useEditor.getState().commit(updateNodeConfig(doc, node.id, f.key, v), `cfg:${node.id}:${f.key}`)}
        />
      ))}
      {actions}
    </div>
  );
}
