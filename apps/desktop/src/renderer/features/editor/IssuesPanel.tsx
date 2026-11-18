import { currentDoc, issuesOf, useEditor } from "../../stores/editor";

export function IssuesPanel({ onGoToNode }: { onGoToNode: () => void }) {
  const doc = useEditor(currentDoc)!;
  const issues = [...issuesOf(doc)].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "error" ? -1 : 1));

  if (issues.length === 0) return <p className="text-sm text-ok">Nenhum problema encontrado. O fluxo está válido.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {issues.map((i, k) => {
        const text = (
          <>
            <span className="font-semibold">{i.severity === "error" ? "Erro" : "Aviso"}: </span>
            {i.message}
          </>
        );
        return (
          <li key={k} className={`rounded-md border p-2 text-sm ${i.severity === "error" ? "border-danger" : "border-line"}`}>
            {i.nodeId ? (
              <button
                type="button"
                className="w-full text-left"
                onClick={() => {
                  useEditor.getState().select([i.nodeId!]);
                  onGoToNode();
                }}
              >
                {text}
              </button>
            ) : (
              text
            )}
          </li>
        );
      })}
    </ul>
  );
}
