// Type declarations for the judgment-layer contract (plain ESM, no build step).
// Implementation: public/play/js/brain.js.
export type Behavior = "approach" | "avoid" | "explore" | "freeze";
export interface Signals {
  food: number;
  threat: number;
  light: number;
  novelty: number;
}
export interface FlyState {
  signals: Signals;
  energy: number;
  timeLeft: number;
  behavior: Behavior;
}
export interface DecisionRecord {
  tick: number;
  state: FlyState;
  question: string;
  distribution: Record<Behavior, number>;
  behavior: Behavior;
  confidence: number;
  dangerScore: number;
  model: string;
  latencyMs: number;
  contentHash: string;
}
export interface BrainDecision {
  behavior: Behavior;
  confidence: number;
  record: DecisionRecord;
}
export interface Brain {
  model: string;
  decide(state: FlyState): Promise<BrainDecision>;
  reset?(): void;
}
export declare const BEHAVIORS: Behavior[];
export declare function stableStringify(v: unknown): string;
export declare function contentHash(input: unknown): string;
export declare function round2(n: number): number;
export declare function clamp01(n: number): number;
export declare function normalizeState(state: FlyState): FlyState;
export declare function sealRecord(record: DecisionRecord): DecisionRecord;
