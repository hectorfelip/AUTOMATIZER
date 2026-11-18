/** Histórico de desfazer/refazer sobre snapshots imutáveis. Puro: não conhece React nem o documento. */
export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  lastKey: string | null;
  lastAt: number;
}

const LIMIT = 100;
const COALESCE_MS = 1000;

export const createHistory = <T>(present: T): History<T> => ({ past: [], present, future: [], lastKey: null, lastAt: 0 });

/**
 * Registra uma mudança. Mudanças seguidas com a mesma `key` em menos de 1s (ex.: digitar num campo)
 * viram um único passo de desfazer.
 */
export function commit<T>(h: History<T>, next: T, key: string | null = null, now: number = Date.now()): History<T> {
  if (next === h.present) return h;
  if (key !== null && key === h.lastKey && now - h.lastAt < COALESCE_MS) {
    return { ...h, present: next, future: [], lastAt: now };
  }
  return { past: [...h.past, h.present].slice(-LIMIT), present: next, future: [], lastKey: key, lastAt: now };
}

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1]!, future: [h.present, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  return { past: [...h.past, h.present], present: h.future[0]!, future: h.future.slice(1), lastKey: null, lastAt: 0 };
}

export const canUndo = <T>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T>(h: History<T>): boolean => h.future.length > 0;
