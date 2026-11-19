/** Gravador (ADR 0016). Os eventos nunca saem da memória do Main; a interface só vê passos para revisão. */
export interface RecordedStep {
  id: string;
  kind: "click" | "type" | "hotkey" | "wait";
  x?: number;
  y?: number;
  button?: "left" | "right" | "double";
  /** Texto digitado. Vazio quando `sensitive` (modo senha: nada foi gravado). */
  text?: string;
  sensitive?: boolean;
  keys?: string[];
  seconds?: number;
}
export type RecorderState = "idle" | "starting" | "recording" | "stopping";
export interface RecorderStatus {
  state: RecorderState;
  events: number;
  paused: boolean;
  secret: boolean;
  notice: string | null;
}
export interface CreateFromRecordingInput {
  name: string;
  steps: RecordedStep[];
}
