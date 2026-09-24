// brain-local.js — local heuristic judgment brain (local-heuristic/0.1).
// Same Brain contract as the FFW-CX circuit and the remote System One brain,
// but it needs no key and no network: a softmax over the same four signals
// the other brains see. It is the default judgment layer AND the fallback
// when the remote brain fails (the fly keeps judging, just offline).
//
// Plain ESM, no build step, browser + node. Types: brain-local.d.ts.

import { BEHAVIORS, normalizeState, sealRecord, clamp01 } from "./brain.js";
import { dexp } from "./dmath.js";

export const LOCAL_MODEL_VERSION = "local-heuristic/0.1";

// The question text is part of the auditable record — it must stay stable
// or hashes stop matching across versions. English, pinned.
export const BEHAVIOR_CRITERIA = {
  approach: "move toward food when the food signal is strong and the threat is containable",
  avoid: "move away immediately when the threat signal is significant or rising",
  explore: "head for unvisited areas when no threat is urgent and food is unclear",
  freeze: "stay still when a threat is present but not urgent, or energy must be saved",
};

export const QUESTION_TEXT = "Which behavior should this fruit fly execute next?";

export function buildLocalDecision(state) {
  const s = normalizeState(state);
  const hunger = 1 - clamp01(s.energy / 100);
  // Weight family isomorphic to the FFW-CX evidence readout, temperature 0.42.
  const raw = {
    approach: 1.3 * s.signals.food * (0.4 + hunger) - 0.5 * s.signals.threat + 0.1,
    avoid: 1.5 * s.signals.threat - 0.2 * s.signals.food,
    explore: 1.15 * s.signals.novelty + 0.25 * s.signals.light - 0.35 * s.signals.threat + 0.05,
    freeze: 0.55 * s.signals.threat - 0.35 * hunger + 0.05,
  };
  const keys = BEHAVIORS;
  const max = Math.max(...keys.map((k) => raw[k]));
  const exps = keys.map((k) => dexp((raw[k] - max) / 0.42));
  const sum = exps.reduce((a, b) => a + b, 0);
  const distribution = {};
  keys.forEach((k, i) => { distribution[k] = exps[i] / sum; });
  const behavior = keys[exps.indexOf(Math.max(...exps))];
  const confidence = distribution[behavior];
  const dangerScore = Math.min(3, Math.max(0, s.signals.threat * 3.2));
  return { state: s, distribution, behavior, confidence, dangerScore };
}

export function createLocalBrain() {
  let tick = 0;
  return {
    model: LOCAL_MODEL_VERSION,
    reset() { tick = 0; },
    decide(state) {
      const d = buildLocalDecision(state);
      const record = sealRecord({
        tick: tick++,
        state: d.state,
        question: QUESTION_TEXT,
        distribution: {
          approach: d.distribution.approach,
          avoid: d.distribution.avoid,
          explore: d.distribution.explore,
          freeze: d.distribution.freeze,
        },
        behavior: d.behavior,
        confidence: d.confidence,
        dangerScore: d.dangerScore,
        model: LOCAL_MODEL_VERSION,
        latencyMs: 0,
        contentHash: "",
      });
      return Promise.resolve({ behavior: d.behavior, confidence: d.confidence, record });
    },
  };
}
