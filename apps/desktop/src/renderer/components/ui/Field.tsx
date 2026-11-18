import { useId, type InputHTMLAttributes } from "react";

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

export function Field({ label, className = "", ...rest }: Props) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        className={`rounded-md border border-line bg-bg px-3 py-2 text-fg placeholder:text-muted ${className}`}
        {...rest}
      />
    </div>
  );
}
