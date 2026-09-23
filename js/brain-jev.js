// brain-jev.js — remote System One judgment brain (Jev / API-compatible backends).
// Sends dish state to a System One endpoint as one choice question (behavior)
// plus one score question (danger) evaluated in parallel, and maps the typed
// answers back into the shared Brain contract. Model version is pinned —
// "latest" floating aliases are rejected because replay requires an exact model.
//
// Default endpoint is the same-origin /api/jev proxy (CORS + key hygiene).
// Point `endpoint` at a local kev/NanoJev instance to run the same harness
// against an open backend.
//
// Plain ESM, no build step, browser + node. Types: brain-jev.d.ts.

import { BEHAVIORS, normalizeState, sealRecord } from "./brain.js";
import { BEHAVIOR_CRITERIA, QUESTION_TEXT } from "./brain-local.js";

export const JEV_MODEL_DEFAULT = "jev-1.13.0";
export const JEV_ENDPOINT_DEFAULT = "/api/jev";

export function buildJevRequest(state, model) {
  const s = normalizeState(state);
  return {
    model,
    state: {
      creature: "fruit fly in a petri dish, surviving",
      signals: s.signals,
      energy: s.energy,
      time_left_s: s.timeLeft,
      current_behavior: s.behavior,
    },
    questions: {
      action: {
        type: "choice",
        instructions: QUESTION_TEXT,
        criteria: BEHAVIOR_CRITERIA,
      },
      danger: {
        type: "score",
        instructions: "How dangerous is the fly's current situation?",
        levels: { 0: "safe", 1: "mild threat", 2: "significant threat", 3: "lethal threat" },
      },
    },
  };
}

export function createJevBrain(opts) {
  const model = opts.model || JEV_MODEL_DEFAULT;
  if (model.includes("latest")) {
    throw new Error("model version must be pinned; floating aliases like jev-latest break replay");
  }
  const endpoint = opts.endpoint || JEV_ENDPOINT_DEFAULT;
  const fetchFn = opts.fetchFn || fetch;
  let tick = 0;

  return {
    model,
    endpoint,
    reset() { tick = 0; },
    async decide(state) {
      const req = buildJevRequest(state, model);
      const started = typeof performance !== "undefined" ? performance.now() : Date.now();
      const res = await fetchFn(endpoint, {
        method: "POST",
        headers: {
          Authorization: "Bearer " + opts.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(req),
      });
      const latencyMs = Math.round(
        (typeof performance !== "undefined" ? performance.now() : Date.now()) - started
      );
      if (!res.ok) throw new Error("jev " + res.status);
      const json = await res.json();
      const action = json && json.answers && json.answers.action;
      if (!action || BEHAVIORS.indexOf(action.choice) < 0) {
        // schema-valid wrong options must not silently steer the fly
        throw new Error("jev returned an unknown behavior choice");
      }
      const danger = json.answers.danger;
      const distribution = {};
      for (const k of BEHAVIORS) distribution[k] = action.probabilities[k] || 0;
      const record = sealRecord({
        tick: tick++,
        state: req.state,
        question: QUESTION_TEXT,
        distribution,
        behavior: action.choice,
        confidence: action.confidence,
        dangerScore: danger && typeof danger.score === "number" ? danger.score : 0,
        model,
        latencyMs,
        contentHash: "",
      });
      return { behavior: action.choice, confidence: action.confidence, record };
    },
  };
}
