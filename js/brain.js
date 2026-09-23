// brain.js — the shared judgment-layer contract for Fruit Fly World.
// A Brain maps dish state to one of four behaviors plus a confidence, and
// returns a DecisionRecord that makes every decision auditable and replayable.
// Backends (circuit, local heuristic, remote System One-compatible models)
// implement the same interface so the world never knows which brain is driving.
//
// Plain ESM, no build step, browser + node. Types: brain.d.ts.

export const BEHAVIORS = ["approach", "avoid", "explore", "freeze"];

// ---------- deterministic hash (FNV-1a 32bit) for replay verification ----------
export function stableStringify(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}

export function contentHash(input) {
  const s = stableStringify(input);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ---------- state normalization (records must hash identically across runs) ----------
export function round2(n) {
  return Math.round(n * 100) / 100;
}

export function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

export function normalizeState(state) {
  return {
    signals: {
      food: round2(state.signals.food),
      threat: round2(state.signals.threat),
      light: round2(state.signals.light),
      novelty: round2(state.signals.novelty),
    },
    energy: round2(state.energy),
    timeLeft: round2(state.timeLeft),
    behavior: state.behavior,
  };
}

// Fill in contentHash for a record (latency and the hash itself are excluded).
export function sealRecord(record) {
  record.contentHash = contentHash({
    ...record,
    contentHash: undefined,
    latencyMs: undefined,
  });
  return record;
}
