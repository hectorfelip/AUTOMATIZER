import { useEffect, useRef, type ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}

/** <dialog> nativo: foco preso, Esc fecha e leitores de tela anunciam o título. */
export function Dialog({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      className="m-auto w-[28rem] max-w-[90vw] rounded-lg border border-line bg-panel p-0 text-fg backdrop:bg-black/50"
    >
      {open && (
        <div className="flex flex-col gap-4 p-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
