// cx-circuit.js — FFW-CX/0.1, a connectome-constrained decision circuit.
// Ported verbatim (numerics byte-identical) from the reference implementation
// (reference/ffw-cx/circuit.ts): 24 neurons, fixed evaluation order, the only
// randomness is a construction-time mulberry32 stream. Four sensory signals in,
// four behaviors out — the same I/O contract the judgment layer uses.
//
// Neurons (fixed roster order — determinism requires it):
//   sensory 0 ORN_food · 1 LPLC2 · 2 LC4 · 3 LIGHT · 4 NOV
//   olfactory 5-7 PN(3) · 8-15 KC(8) · 16 APL · 17 LH
//   hunger 18 NPF · escape 19 GF(DNp01)
//   behavior 20 DN_approach · 21 DN_avoid · 22 DN_explore · 23 DN_freeze

import { dexp } from "./dmath.js";

export const CX_MODEL_VERSION = "FFW-CX/0.1";

// mulberry32: the only random source, consumed at construction time only.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU_SYN = 4; // synaptic current decay (ticks): temporally close spikes sum
const SYN_DECAY = dexp(-1 / TAU_SYN);
const REFRACTORY_TICKS = 2;

function makeNeuron(name, thresh, tau) {
  return { name, v: 0, syn: 0, rest: 0, thresh, tau, refractory: 0 };
}

export function createCircuit(opts) {
  const rng = mulberry32(opts.seed);

  const neurons = [
    makeNeuron("ORN_food", 0.5, 2),
    makeNeuron("LPLC2", 0.5, 2),
    makeNeuron("LC4", 0.55, 2.5),
    makeNeuron("LIGHT", 0.6, 3),
    makeNeuron("NOV", 0.6, 3),
    makeNeuron("PN1", 0.55, 3),
    makeNeuron("PN2", 0.55, 3),
    makeNeuron("PN3", 0.55, 3),
    ...Array.from({ length: 8 }, (_, i) => makeNeuron("KC" + (i + 1), 0.65, 4)),
    makeNeuron("APL", 0.45, 3),
    makeNeuron("LH", 0.55, 3),
    makeNeuron("NPF", 0.4, 6),
    makeNeuron("GF", 1.0, 2), // giant fiber: high threshold, fast membrane — all-or-none
    makeNeuron("DN_approach", 0.6, 6),
    makeNeuron("DN_avoid", 0.6, 5),
    makeNeuron("DN_explore", 0.6, 6),
    makeNeuron("DN_freeze", 0.55, 7),
  ];

  const idx = Object.fromEntries(neurons.map((n, i) => [n.name, i]));

  const synapses = [];
  const S = (from, to, w) => synapses.push({ from: idx[from], to: idx[to], w });

  // olfactory: ORN → PN (three glomeruli, slightly different gains)
  S("ORN_food", "PN1", 0.5);
  S("ORN_food", "PN2", 0.4);
  S("ORN_food", "PN3", 0.3);

  // PN → KC: each KC takes 2-3 PNs (seed-fixed random divergence, real motif)
  for (let k = 0; k < 8; k++) {
    const pns = [0, 1, 2].filter(() => rng() < 0.75);
    const chosen = pns.length ? pns : [Math.floor(rng() * 3)];
    for (const p of chosen) {
      synapses.push({ from: 5 + p, to: 8 + k, w: 0.35 + rng() * 0.2 });
    }
  }

  // KC → APL (excite), APL → all KC (inhibit): global inhibition → sparse code
  for (let k = 0; k < 8; k++) S("KC" + (k + 1), "APL", 0.22);
  for (let k = 0; k < 8; k++) S("APL", "KC" + (k + 1), -0.5);

  // KC → MBON approximation feeding DN_approach (learned); LH → approach (innate)
  for (let k = 0; k < 8; k++) S("KC" + (k + 1), "DN_approach", 0.1);
  S("PN1", "LH", 0.45);
  S("PN2", "LH", 0.3);
  S("LH", "DN_approach", 0.5);

  // escape: looming detectors → giant fiber
  S("LPLC2", "GF", 0.65);
  S("LC4", "GF", 0.55);
  // GF drives avoid hard and inhibits approach (escape wins)
  S("GF", "DN_avoid", 1.2);
  S("GF", "DN_approach", -0.6);
  // sub-threshold looming → freeze (freezing at low-intensity approach is real)
  S("LPLC2", "DN_freeze", 0.25);
  // innate threat avoidance: LC4 → avoid weak direct
  S("LC4", "DN_avoid", 0.2);

  // light / novelty → explore
  S("LIGHT", "DN_explore", 0.25);
  S("NOV", "DN_explore", 0.55);
  // novelty mildly drives approach too (new areas may hold food)
  S("NOV", "DN_approach", 0.12);

  // NPF (hunger) → olfactory gain modulation
  S("NPF", "PN1", 0.3);
  S("NPF", "PN2", 0.24);
  S("NPF", "PN3", 0.18);

  const neuronNames = neurons.map((n) => n.name);

  function step(signals, hunger) {
    const h = Math.min(1, Math.max(0, hunger));

    // Sensory input → direct current. Hunger gate: food current × (1 + 0.9h)
    // (NPF-DAN motif: starvation amplifies food-odor gain).
    const drive = [
      [idx.ORN_food, signals.food * (1 + 0.9 * h)],
      [idx.LPLC2, signals.threat],
      [idx.LC4, signals.threat * 0.8],
      [idx.LIGHT, signals.light * 0.6],
      [idx.NOV, signals.novelty],
      [idx.NPF, h],
    ];

    const spiked = new Array(neurons.length).fill(0);

    // Fixed evaluation order: synapse decay + drive → membrane update → spikes.
    for (let i = 0; i < neurons.length; i++) {
      neurons[i].syn *= SYN_DECAY;
    }
    for (const [i, current] of drive) neurons[i].syn += current;

    for (let i = 0; i < neurons.length; i++) {
      const n = neurons[i];
      if (n.refractory > 0) {
        n.refractory -= 1;
        n.v = n.rest;
      } else {
        n.v += (-(n.v - n.rest) + n.syn) / n.tau;
        if (n.v >= n.thresh) {
          spiked[i] = 1;
          n.v = n.rest;
          n.refractory = REFRACTORY_TICKS;
        }
      }
    }
    // Spikes enter target synaptic current at end of tick (integrate next step).
    for (const s of synapses) {
      if (spiked[s.from]) neurons[s.to].syn += s.w;
    }

    // Behavior readout: downstream membrane potentials are the evidence.
    const evidence = {
      approach: Math.max(0, neurons[idx.DN_approach].v),
      avoid: Math.max(0, neurons[idx.DN_avoid].v),
      explore: Math.max(0, neurons[idx.DN_explore].v),
      freeze: Math.max(0, neurons[idx.DN_freeze].v) + 0.05, // freeze base bias
    };

    const gfFired = spiked[idx.GF] === 1;
    let behavior, confidence;
    const keys = Object.keys(evidence);
    let exps = null;
    let sum = 0;

    if (gfFired) {
      // Giant fiber is a command neuron: firing means escape, bypass softmax.
      behavior = "avoid";
      confidence = 0.95;
    } else {
      const max = Math.max(...keys.map((k) => evidence[k]));
      exps = keys.map((k) => dexp((evidence[k] - max) / 0.15));
      sum = exps.reduce((a, b) => a + b, 0);
      behavior = keys[exps.indexOf(Math.max(...exps))];
      confidence = Math.max(...exps) / sum;
    }

    const probabilities = {};
    if (gfFired) {
      probabilities.approach = 0; probabilities.avoid = 1;
      probabilities.explore = 0; probabilities.freeze = 0;
    } else {
      for (let i = 0; i < keys.length; i++) probabilities[keys[i]] = exps[i] / sum;
    }

    const spikes = {};
    neurons.forEach((n, i) => {
      if (spiked[i]) spikes[n.name] = 1;
    });

    return { behavior, confidence, probabilities, evidence, spikes, gfFired };
  }

  return { step, version: CX_MODEL_VERSION, neuronNames };
}
