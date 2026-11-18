const tones = { ok: "text-ok border-ok", muted: "text-muted border-line", danger: "text-danger border-danger" };

/** O estado vai sempre em texto; a cor só reforça (acessibilidade, PROJECT_SPEC §5). */
export function Badge({ tone = "muted", children }: { tone?: keyof typeof tones; children: string }) {
  return <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}
