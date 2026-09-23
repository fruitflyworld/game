// Type declarations for the browser-side neural module (plain ESM, no build step).
// The implementation is public/play/js/gf-neuron.js.
export interface GFNeuronState {
  pot: number;
  prevTheta: number;
  armed: boolean;
  lastFire: number;
  iframe: number;
  lc4: number;
  lplc2: number;
}
export interface GFStepOptions {
  size: number;
  vel: number;
  mode: "real" | "shuffled" | string;
  leakRate?: number;
  threshold?: number;
  now?: number;
  refractory?: number;
}
export declare const GF_PARAMS: {
  W_LC4: number;
  W_LPLC2: number;
  SIZE_PEAK: number;
  SIZE_WIDTH: number;
  VEL_GAIN: number;
  THRESHOLD: number;
  LEAK_RATE_GAME: number;
  LEAK_RATE_ASSAY: number;
};
export declare function makeGFState(): GFNeuronState;
export declare function senseLC4(vel: number): number;
export declare function senseLPLC2(size: number): number;
export declare function gfChannels(size: number, vel: number): { lc4: number; lplc2: number };
export declare function gfPotential(size: number, vel: number, mode: string): number;
export declare function stepGF(state: GFNeuronState, dt: number, opts: GFStepOptions): GFNeuronState;
export declare function fireGF(state: GFNeuronState, now: number): GFNeuronState;
