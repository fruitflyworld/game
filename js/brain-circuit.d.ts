// Type declarations for the circuit Brain wrapper (plain ESM, no build step).
// Implementation: public/play/js/brain-circuit.js.
import type { Brain } from "./brain.js";
export type { Brain };
export declare const CIRCUIT_QUESTION: string;
export declare function createCircuitBrain(opts: { seed: number }): Brain & { reset(): void };
