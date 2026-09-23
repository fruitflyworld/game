import type { Brain, BrainDecision, FlyState } from "./brain.js";
export declare const JEV_MODEL_DEFAULT = "jev-1.13.0";
export declare const JEV_ENDPOINT_DEFAULT = "/api/jev";
export interface JevRequest {
  model: string;
  state: Record<string, unknown>;
  questions: {
    action: { type: "choice"; instructions: string; criteria: Record<string, string> };
    danger: { type: "score"; instructions: string; levels: Record<string, string> };
  };
}
export declare function buildJevRequest(state: FlyState, model: string): JevRequest;
export declare function createJevBrain(opts: {
  apiKey: string;
  model?: string;
  endpoint?: string;
  fetchFn?: typeof fetch;
}): Brain & { endpoint: string; decide(state: FlyState): Promise<BrainDecision> };
