import type { ButtonHTMLAttributes } from "react";

const variants = {
  primary: "bg-brand text-brand-fg hover:opacity-90",
  secondary: "border border-line bg-panel text-fg hover:bg-bg",
  danger: "bg-danger text-brand-fg hover:opacity-90",
} as const;

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants;
  size?: "md" | "sm";
}

export function Button({ variant = "secondary", size = "md", className = "", type = "button", ...rest }: Props) {
  const pad = size === "sm" ? "px-2.5 py-1 text-sm" : "px-4 py-2";
  return (
    <button
      type={type}
      className={`rounded-md font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${variants[variant]} ${className}`}
      {...rest}
    />
  );
}
