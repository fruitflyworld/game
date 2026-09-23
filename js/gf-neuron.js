// gf-neuron.js — pure neural layer of the GF escape circuit. No DOM, no Phaser,
// no environment sensing. Runnable in node AND the browser.
//
// Circuit: looming stimulus → LC4 (angular velocity) + LPLC2 (angular size)
//          → Giant Fiber (leaky integrate-and-fire unit) → escape jump.
//
// Research references, NOT biophysical membrane parameters: in MaleCNS v1.0 the
// Giant Fiber is neuron DNp01; LC4 + LPLC2 supply ~99.6% of its visual input.
// Synapse counts (Ache et al. 2019, FAFB): LC4 = 2442, LPLC2 = 1366. In this
// playable model they are used only as relative weights between the two channels.
//
// real connectivity: the big weight (LC4) rides VELOCITY, which leads angular
// size on a looming strike → more escape lead time.
// shuffled connectivity: weights swapped onto the wrong channels → big weight
// rides SIZE, which lags. This is the experimental control condition.

export const GF_PARAMS = {
  W_LC4: 2442, W_LPLC2: 1366,
  SIZE_PEAK: 1.4, SIZE_WIDTH: 0.7,
  VEL_GAIN: 0.45,
  THRESHOLD: 0.6,
  LEAK_RATE_GAME: 10,  // membrane leak (1/s) in the playable game loop
  LEAK_RATE_ASSAY: 15  // membrane leak (1/s) in the fixed-seed escape assay
};

function clamp01(v){ return Math.min(1, Math.max(0, v)); }

// Neural state. Field names are a public compatibility surface (HUD reads
// pot/lc4/lplc2/armed; FlyLabAPI reads pot/armed; the behavior layer writes
// lastFire/pot/iframe) — do not rename them.
export function makeGFState(){
  return { pot:0, prevTheta:0, armed:false, lastFire:-99, iframe:0, lc4:0, lplc2:0 };
}

// ---- sensory layer: stimulus features → channel activations (pure) ----
export function senseLC4(vel){
  return clamp01(vel*GF_PARAMS.VEL_GAIN); // LC4 → angular velocity (leads)
}
export function senseLPLC2(size){
  return (size>0.08?1:0)*Math.exp(-Math.pow(size-GF_PARAMS.SIZE_PEAK,2)/(2*GF_PARAMS.SIZE_WIDTH*GF_PARAMS.SIZE_WIDTH)); // LPLC2 → angular size (lags)
}
export function gfChannels(size, vel){
  return { lc4:senseLC4(vel), lplc2:senseLPLC2(size) };
}

// ---- integration: weighted sum under real or shuffled connectivity (pure) ----
export function gfPotential(size, vel, mode){
  const c=gfChannels(size,vel), wSum=GF_PARAMS.W_LC4+GF_PARAMS.W_LPLC2;
  if(mode==="real") return (GF_PARAMS.W_LC4*c.lc4 + GF_PARAMS.W_LPLC2*c.lplc2)/wSum;
  return (GF_PARAMS.W_LC4*c.lplc2 + GF_PARAMS.W_LPLC2*c.lc4)/wSum;
}

// ---- one leaky integrate-and-fire step (pure, deterministic) ----
// opts: { size, vel, mode, leakRate = LEAK_RATE_GAME,
//         threshold?, now?, refractory? }
// When threshold/now are given, `armed` is updated: potential at or above
// threshold AND outside the refractory window since lastFire.
export function stepGF(state, dt, opts){
  state.lc4 = senseLC4(opts.vel);
  state.lplc2 = senseLPLC2(opts.size);
  const target = gfPotential(opts.size, opts.vel, opts.mode);
  state.pot += (target-state.pot)*Math.min(1, dt*(opts.leakRate ?? GF_PARAMS.LEAK_RATE_GAME));
  if(opts.threshold!==undefined && opts.now!==undefined){
    state.armed = state.pot>=opts.threshold && (opts.now-state.lastFire)>(opts.refractory ?? 0);
  }
  return state;
}

// ---- firing: called by the behavior layer when the escape actually happens ----
// Resets the membrane and opens the refractory window. One stimulus → one fire.
export function fireGF(state, now){
  state.lastFire = now;
  state.pot = 0;
  state.armed = false;
  return state;
}
