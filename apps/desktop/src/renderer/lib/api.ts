import type { IpcResult } from "@automation-studio/shared-types";

/** Desembrulha o resultado do IPC; falhas viram Error com mensagem pronta para o usuário. */
export async function unwrap<T>(call: (api: Window["api"]) => Promise<IpcResult<T>>): Promise<T> {
  if (!window.api) throw new Error("Interface desktop indisponível. Abra o Automation Studio pelo aplicativo.");
  const res = await call(window.api);
  if (!res.ok) throw new Error(res.error.message);
  return res.data;
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : "Erro inesperado.");
