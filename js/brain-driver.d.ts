// Type declarations for the brain driver (plain ESM, no build step).
// Implementation: public/play/js/brain-driver.js.
import type { Brain, BrainDecision, FlyState } from "./brain.js";
export type { Brain, BrainDecision, FlyState };
export interface BrainDriver {
  readonly model: string;
  readonly degraded: boolean;
  readonly last: BrainDecision | null;
  reset(): void;
  update(
    simTime: number,
    dt: number,
    getState: () => FlyState,
    applyDecision: (res: BrainDecision) => void
  ): void;
}
export interface BrainDriverOptions {
  brain: Brain;
  intervalSec?: number;
  maxStaleSec?: number;
  onError?: (err: unknown) => void;
}
export declare function createBrainDriver(opts: BrainDriverOptions): BrainDriver;
