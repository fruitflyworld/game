// Type declarations for the browser-side simulation module (plain ESM, no build step).
// The implementation is public/play/js/sim.js; the neural layer types come from
// gf-neuron.d.ts. Only the surface consumed by tests and the game scenes is declared.
export declare const GEN_DURATION: number;
export declare const GF: {
  W_LC4: number;
  W_LPLC2: number;
  SIZE_PEAK: number;
  SIZE_WIDTH: number;
  VEL_GAIN: number;
  THRESHOLD: number;
  PRED_ANG_R: number;
};
export interface EscapeTrialResult {
  valid: boolean;
  escaped?: boolean;
  lead?: number;
}
export interface ExperimentResult {
  n: number;
  realEscape: number;
  shufEscape: number;
  realLead: number;
  shufLead: number;
}
export interface FlyGenes {
  food: number;
  threat: number;
  light: number;
  novelty: number;
  forage: number;
}
export interface Fly {
  isPlayer: boolean;
  x: number;
  y: number;
  energy: number;
  alive: boolean;
  eggs: number;
  gf: import("./gf-neuron.js").GFNeuronState;
  traits?: string[];
  rivalTraits?: string[];
  stats?: Record<string, number | boolean>;
}
export declare function seedRng(s: number): void;
export declare function rng(): number;
export declare const STACKABLE: string[];
export declare const NAMED_ONCE: string[];
export declare function makeRng(seed: number): () => number;
export declare function draftSeed(worldSeed: number, gen: number, eggs: number, rivalEggs: number): number;
export declare function draftCards(worldSeed: number, gen: number, eggs: number, rivalEggs: number, owned: string[]): string[];
export declare function rollRivalGenes(seed: number): FlyGenes;
export declare function makeFly(isPlayer: boolean, genes: FlyGenes): Fly;
export declare function simEscapeTrial(mode: string, seed: number): EscapeTrialResult;
export declare function runExperiment(worldSeed: number): ExperimentResult;
