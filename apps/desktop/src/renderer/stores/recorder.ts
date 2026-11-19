import { create } from "zustand";
import type {
  Automation,
  RecordedStep,
  RecorderStatus,
} from "@automation-studio/shared-types";
import { unwrap } from "../lib/api";

const idle: RecorderStatus = {
  state: "idle",
  events: 0,
  paused: false,
  secret: false,
  notice: null,
};

interface State {
  status: RecorderStatus;
  /** Passos em revisão (só existem depois de parar; editáveis; nunca saem da memória até criar a automação). */
  steps: RecordedStep[] | null;
  init(): () => void;
  /** Busca o status fresco do Main (a tela também consulta periodicamente: push perdido ou fora de ordem não pode deixá-la presa). */
  refresh(): Promise<void>;
  start(): Promise<void>;
  pause(): Promise<void>;
  stop(): Promise<void>;
  setSteps(steps: RecordedStep[]): void;
  create(name: string): Promise<Automation>;
  discard(): Promise<void>;
}

export const useRecorder = create<State>((set, get) => {
  /** Status fresco do Main. A resposta de uma ação é um retrato que pode chegar DEPOIS de um push mais novo (ex.: "parou"); por isso nunca é usada para sobrescrever. */
  const refresh = async () =>
    set({ status: await unwrap((a) => a.recorder.status()) });
  return {
    refresh,
    status: idle,
    steps: null,
    init() {
      void unwrap((a) => a.recorder.status()).then(
        (s) => set({ status: s }),
        () => undefined,
      );
      const off = window.api?.recorder.onStatus((s) => set({ status: s }));
      return () => off?.();
    },
    async start() {
      set({ steps: null });
      await unwrap((a) => a.recorder.start());
      await refresh();
    },
    async pause() {
      await unwrap((a) => a.recorder.pause());
      await refresh();
    },
    async stop() {
      set({ steps: await unwrap((a) => a.recorder.stop()) });
    },
    setSteps: (steps) => set({ steps }),
    async create(name) {
      const steps = get().steps ?? [];
      const created = await unwrap((a) => a.recorder.create({ name, steps }));
      set({ steps: null });
      await refresh();
      return created;
    },
    async discard() {
      await unwrap((a) => a.recorder.discard());
      set({ steps: null });
      await refresh();
    },
  };
});
