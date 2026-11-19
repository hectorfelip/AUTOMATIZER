import type { ConfigField } from "@automation-studio/node-registry";
import type { AvailableRefs } from "@automation-studio/workflow-validator";
import { referenceOptions } from "./referenceOptions";

interface Props {
  field: ConfigField;
  refs: AvailableRefs;
  onPick: (ref: string) => void;
}

/** "Inserir…": evita digitar {{nodes.listar.files}} à mão (e errar o nome do nó ou do resultado). */
export function ReferencePicker({ field, refs, onPick }: Props) {
  const groups = referenceOptions(refs, field.kind);
  if (groups.length === 0) return null;
  return (
    <select
      aria-label={`Inserir referência em ${field.label}`}
      value=""
      onChange={(e) => e.target.value && onPick(e.target.value)}
      className="w-full rounded-md border border-line bg-bg px-2 py-1 text-xs text-muted"
    >
      <option value="">Inserir…</option>
      {groups.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.options.map((o) => (
            <option key={o.ref} value={o.ref}>
              {o.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
