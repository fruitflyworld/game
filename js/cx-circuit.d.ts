// Type declarations for the FFW-CX circuit (plain ESM, no build step).
// Implementation: public/play/js/cx-circuit.js.
import type { Behavior, Signals } from "./brain.js";
export type { Behavior, Signals };
export interface CircuitOutput {
  behavior: Behavior;
  confidence: number;
  probabilities: Record<Behavior, number>;
  evidence: Record<Behavior, number>;
  spikes: Record<string, number>;
  gfFired: boolean;
}
export interface Circuit {
  step(signals: Signals, hunger: number): CircuitOutput;
  version: string;
  neuronNames: string[];
}
export declare const CX_MODEL_VERSION: string;
export declare function createCircuit(opts: { seed: number }): Circuit;
