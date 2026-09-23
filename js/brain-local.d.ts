import type { Brain, BrainDecision, FlyState, Behavior } from "./brain.js";
export declare const LOCAL_MODEL_VERSION = "local-heuristic/0.1";
export declare const BEHAVIOR_CRITERIA: Record<Behavior, string>;
export declare const QUESTION_TEXT: string;
export declare function buildLocalDecision(state: FlyState): {
  state: FlyState;
  distribution: Record<Behavior, number>;
  behavior: Behavior;
  confidence: number;
  dangerScore: number;
};
export declare function createLocalBrain(): Brain & { decide(state: FlyState): Promise<BrainDecision> };
