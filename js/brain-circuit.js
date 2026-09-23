// brain-circuit.js — wraps the FFW-CX spiking circuit into the Brain contract.
// The brainstem of the game: deterministic, offline, free. Every decision is
// sealed into a DecisionRecord so runs can be replayed and verified bit-for-bit.

import { createCircuit, CX_MODEL_VERSION } from "./cx-circuit.js";
import { normalizeState, sealRecord, clamp01, round2 } from "./brain.js";

export const CIRCUIT_QUESTION =
  "Circuit step: signals + hunger → 24-neuron spiking readout (approach/avoid/explore/freeze).";

export function createCircuitBrain(opts) {
  let circuit = createCircuit({ seed: opts.seed >>> 0 });
  let tick = 0;

  return {
    model: CX_MODEL_VERSION,

    reset() {
      circuit = createCircuit({ seed: opts.seed >>> 0 });
      tick = 0;
    },

    decide(state) {
      const hunger = 1 - clamp01(state.energy / 100);
      const out = circuit.step(state.signals, hunger);
      const s = normalizeState(state);
      const record = {
        tick: tick++,
        state: s,
        question: CIRCUIT_QUESTION,
        distribution: {
          approach: round2(out.probabilities.approach),
          avoid: round2(out.probabilities.avoid),
          explore: round2(out.probabilities.explore),
          freeze: round2(out.probabilities.freeze),
        },
        behavior: out.behavior,
        confidence: round2(out.confidence),
        dangerScore: out.gfFired ? 3 : round2(clamp01(state.signals.threat) * 3.2),
        model: CX_MODEL_VERSION,
        latencyMs: 0,
        contentHash: "",
      };
      sealRecord(record);
      return Promise.resolve({ behavior: out.behavior, confidence: out.confidence, record });
    },
  };
}
