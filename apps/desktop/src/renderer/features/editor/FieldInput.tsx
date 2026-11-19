import type { ConfigField } from "@automation-studio/node-registry";
import type { ConfigValue } from "@automation-studio/workflow-schema";
import type { AvailableRefs } from "@automation-studio/workflow-validator";
import { useId } from "react";
import { useAutomations } from "../../stores/automations";
import { useEditor } from "../../stores/editor";
import { ReferencePicker } from "./ReferencePicker";
import { insertReference } from "./referenceOptions";

interface Props {
  field: ConfigField;
  value: ConfigValue | undefined;
  error?: string;
  /** Referências disponíveis para este campo (variáveis, resultados de nós anteriores, item do laço). */
  refs?: AvailableRefs;
  onChange: (value: ConfigValue) => void;
}

const NUMERIC = /^-?\d+(\.\d+)?$/;
const input = "w-full rounded-md border bg-bg px-3 py-1.5 text-sm text-fg placeholder:text-muted";

/** Um campo do painel de propriedades, gerado a partir do contrato do nó. */
export function FieldInput({ field, value, error, refs, onChange }: Props) {
  const id = useId();
  const errId = `${id}-err`;
  const border = error ? "border-danger" : "border-line";
  const automations = useAutomations((st) => st.items);
  const self = useEditor((st) => st.automationId);
  const common = { id, "aria-invalid": error ? true : undefined, "aria-describedby": error ? errId : undefined };

  let control;
  if (field.kind === "boolean") {
    control = (
      <input type="checkbox" {...common} checked={value === true} onChange={(e) => onChange(e.target.checked)} className="h-4 w-4" />
    );
  } else if (field.kind === "automation") {
    const options = automations.filter((a) => a.status === "active" && a.id !== self);
    const unknown = typeof value === "string" && value !== "" && !options.some((a) => a.id === value);
    control = (
      <select {...common} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={`${input} ${border}`}>
        <option value="">Selecione…</option>
        {unknown && <option value={value as string}>(fluxo indisponível)</option>}
        {options.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
    );
  } else if (field.kind === "select") {
    control = (
      <select {...common} value={typeof value === "string" ? value : ""} onChange={(e) => onChange(e.target.value)} className={`${input} ${border}`}>
        {value === undefined || value === null || value === "" ? <option value="">Selecione…</option> : null}
        {field.options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  } else {
    // number aceita também `{{variables.x}}`: guarda número quando o texto é numérico, senão o texto.
    const isNumber = field.kind === "number";
    control = (
      <input
        type="text"
        inputMode={isNumber ? "decimal" : undefined}
        {...common}
        value={value === undefined || value === null ? "" : String(value)}
        placeholder={field.placeholder}
        onChange={(e) => onChange(isNumber && NUMERIC.test(e.target.value.trim()) ? Number(e.target.value) : e.target.value)}
        className={`${input} ${border}`}
      />
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {field.label}
        {field.required && <span aria-hidden="true"> *</span>}
      </label>
      {control}
      {refs && field.kind !== "boolean" && field.kind !== "select" && field.kind !== "automation" && !field.literal && (
        <ReferencePicker field={field} refs={refs} onPick={(ref) => onChange(insertReference(value === undefined || value === null ? "" : String(value), ref, field.kind))} />
      )}
      {field.help && <p className="text-xs text-muted">{field.help}</p>}
      {error && (
        <p id={errId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
