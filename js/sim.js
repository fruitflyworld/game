// sim.js — pure simulation logic (no DOM, no Phaser). Runnable in node AND the browser.
// Ported verbatim from the validated fly-lab.html prototype (2026-09-17).

// ---------- constants ----------
export const GEN_DURATION = 50;
export const CYCLE_SEC = 25;
export const BASE_SPEED = 0.40;
export const METABOLISM = 2.6;
export const FOOD_RADIUS = 0.06;
export const FOOD_SENSE = 0.6;
export const THREAT_SENSE = 0.75;
export const NOVELTY_SENSE = 0.45;
export const GRID_N = 9;
export const FOOD_COUNT = 8;
export const LAY_THRESHOLD = 68;
export const LAY_COST = 44;
export const LAY_CD = 1.4;
export const DASH_SPEED = 3.0, DASH_TIME = 0.22, DASH_CD = 1.9, DASH_COST = 5;
export const PRED_BASE = 0.235, PRED_LUNGE = 0.42, PRED_LUNGE_RANGE = 0.22, PRED_CATCH = 0.075, PRED_DPS = 55;

// ---------- escape reflex circuit (looming → Giant Fiber → jump) ----------
// The neural layer lives in ./gf-neuron.js (pure state transitions). This module
// keeps the original export surface and owns only the environment geometry.
// Synapse counts LC4=2442 / LPLC2=1366 are research references (Ache et al. 2019,
// FAFB; MaleCNS DNp01), not biophysical membrane parameters.
import { dcos, dsin, datan } from "./dmath.js";
import { GF_PARAMS, makeGFState, stepGF, fireGF } from "./gf-neuron.js";
export { GF_PARAMS, gfChannels, gfPotential, makeGFState, stepGF, fireGF } from "./gf-neuron.js";
export const GF = { ...GF_PARAMS, PRED_ANG_R: 0.11 };
export const PRED_VISUAL = 0.8;

export const FOOD_TYPES = {
  sugar: { gain: 12, color: "food",     label: "Sugar" },
  yeast: { gain: 26, color: "gold",     label: "Yeast" },
  rot:   { gain: 38, color: "lavender", label: "Rot" }
};
export const ODOR_TIME = 6;

export const TRAIT_INFO = {
  white:{name:"White eye", good:"Sense range +25%", bad:"Night sense penalty ×2 (white eyes see poorly at night)", eye:"#e8e2d0", src:"white gene · Morgan 1910 (the first genetics mutation)"},
  curly:{name:"Curly wing", good:"Speed +18%", bad:"Metabolism +15%", src:"curly wing-shape mutation line"},
  vestigial:{name:"Vestigial wing", good:"Energy cap +60; metabolism -10%", bad:"GF jump distance -40% (vestigial wings barely fly)", syn:"with Giant = a tank lineage that holds ground but runs slow", src:"vestigial wing mutation line"},
  ebony:{name:"Ebony", good:"Predator damage -30%", bad:"Sense -12%", body:"#3a3630", src:"ebony body-colour mutation line"},
  fecund:{name:"Fecund", good:"Egg cost -22%", bad:"Laying exposes odor for 2s", syn:"with Forager = an egg engine", src:"fertility trait"},
  swift:{name:"Swift", good:"Dash cooldown -30%", bad:"Dash cost +40%", syn:"with Shaker = chained escapes", src:"flight-speed trait"},
  hardy:{name:"Hardy", good:"Metabolism -16%", bad:"Speed -8%", src:"starvation-tolerance trait"},
  nocturnal:{name:"Nocturnal", good:"No sense penalty at night", bad:"", syn:"with Tiger = night foraging; with Clock = a day-and-night build", src:"activity polymorphism"},
  shaker:{name:"Shaker", good:"Speed +40% for 1.5s after a GF escape", bad:"", syn:"with Swift: run once you are clear", src:"shaker mutation line (K+ channel)"},
  forager:{name:"Forager", good:"Food energy +35% (stacks)", bad:"Speed -18% for 1s after feeding", syn:"with Fecund: an egg engine", src:"foraging gene (rover/sitter locus)"},
  thrift:{name:"Thrift", good:"Rot no longer exposes odor", bad:"", syn:"unlocks a rot farm: +38 rot for free; with Adh for belt and braces", src:"rot-feeding tolerance strategy"},
  tiger:{name:"Tiger", good:"Bite knocks back and stuns the predator (8s cooldown)", bad:"", syn:"with Nocturnal: raid the rot at night", src:"warning colouration / anti-predator behaviour"},
  giant:{name:"Giant", good:"Energy cap +60; the GF reflex fires more easily", bad:"Speed -15%", syn:"with Hardy: a tank lineage", src:"body-size trait"},
  rover:{name:"Rover", good:"Speed +10%; food sense +20%", bad:"Metabolism +12%; eaten food bounces further", syn:"mutually exclusive with Sitter", src:"foraging gene, rover phenotype (a real polymorphism)"},
  sitter:{name:"Sitter", good:"Food respawns where it was eaten; feeding +25%", bad:"Speed -10%", syn:"mutually exclusive with Rover · the core of a sit-and-wait build", src:"foraging gene, sitter phenotype (a real polymorphism)"},
  mimic:{name:"Mimic", good:"Predator loses you while you hold still (useless at night)", bad:"Holding still still burns energy", syn:"a freeze tactic that fights the keep-moving instinct", src:"predators hunt on motion vision (real)"},
  cannibal:{name:"Cannibal", good:"Beside the wild type: drain 2 energy a second and slow it 20%", bad:"Feeding exposes your odor at the same time", src:"cannibalism in fruit-fly larvae (real behaviour)"},
  diapause:{name:"Diapause", good:"Under 30 energy: metabolism -60%, predator interest -50% (playing dead)", bad:"Speed -40% and no jump while in diapause", src:"diapause phenotype (a real stress strategy)"},
  adh:{name:"Adh", good:"Rot no longer exposes odor and grants a 4s drunken sprint (speed +25%)", bad:"Turning goes sluggish while sprinting", src:"alcohol dehydrogenase (Adh) gene (rot = fermentation = alcohol)"},
  phototax:{name:"Phototaxis", good:"Inside the light: metabolism -30% (sunbathing heals)", bad:"At night the lamp keeps pulling you out of the dark", syn:"splits from Nocturnal: day crew / night crew", src:"phototaxis plus the motion-vision circuit (T4/T5)"},
  guard:{name:"Guard", good:"Sitting on your own egg cluster makes the predator hit the wild type first", bad:"The predator can eat your eggs in passing", src:"egg-guarding behaviour (a real maternal strategy)"},
  clock:{name:"Clock", good:"Daytime metabolism -20%", bad:"Night metabolism +20%, sense -10%", syn:"with Nocturnal = a day-and-night build; alone = a diurnal build", src:"period gene / LNv clock neurons (a real circadian circuit)"},
  hopper:{name:"Hopper", good:"Jump at full mass whenever you like (no gambling on GF timing)", bad:"Active jumps cost ×1.5 energy and +50% cooldown", syn:"the active-dodge build: the card that changes GF play the most", src:"jump-behaviour plasticity (an up-regulated escape program)"},
  pheromone:{name:"Pheromone", good:"You are tipped off when the wild type lays; food near its cluster gives +50% for 3s", bad:"Your own laying broadcasts on the same channel", src:"cuticular hydrocarbon signals (real chemical communication)", syn:"information warfare in miniature: an arms race you can watch"}
};
export const NAMED_ONCE = ["white","curly","vestigial","ebony","nocturnal","shaker","thrift","tiger","giant",
  "sitter","mimic","cannibal","diapause","adh","phototax","guard","clock","hopper","pheromone"];
export const STACKABLE = ["fecund","swift","hardy","forager","rover"];
// rarity pools for the weighted draft (common 60 / rare 30 / epic 10)
export const RARITY_KEYS = {
  common:["white","curly","ebony","fecund","swift","hardy","nocturnal","shaker","forager","thrift","tiger","giant"],
  rare:["sitter","rover","diapause","adh","phototax","pheromone","clock","vestigial"],
  epic:["mimic","hopper","cannibal","guard"]
};

// ---------- helpers ----------
export function clamp01(v){ return Math.min(1, Math.max(0, v)); }
export function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
export function normalize(v){ const m=Math.hypot(v.x,v.y); return m<1e-6?{x:0,y:0}:{x:v.x/m,y:v.y/m}; }

// ---------- seeded RNG (mulberry32) — same seed reproduces the same world ----------
let _rngState = 1337 >>> 0;
export function rng(){ _rngState|=0; _rngState=(_rngState+0x6D2B79F5)|0; let t=Math.imul(_rngState^(_rngState>>>15),1|_rngState); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }
export function seedRng(s){ _rngState=(s>>>0)||1; }
export function randRange(a,b){ return a+rng()*(b-a); }
export function randomInDish(maxR=0.85){ const a=rng()*Math.PI*2, r=Math.sqrt(rng())*maxR; return {x:dcos(a)*r, y:dsin(a)*r}; }

// ---------- GF circuit (pure) ----------
// gfChannels / gfPotential are re-exported from ./gf-neuron.js above.

// ---------- stats from traits ----------
export function recomputeStats(fly){
  let speed=BASE_SPEED, metab=METABOLISM, maxE=100, senseMult=1, predDmg=1, layCost=LAY_COST, dashCd=DASH_CD, nocturnal=false;
  let foodMult=1, noOdor=false, reflexBoost=false, tiger=false, gfThresh=GF.THRESHOLD;
  let speedTurn=1;
  // P1 behavior switches / extra fields (consumed via stats.* in scene-game hooks)
  let foodSenseMult=1, nightPenalty=1, gfJumpMult=1;
  let rover=false, sitter=false, mimic=false, cannibal=false, diapause=false, adh=false;
  let fecund=false, swift=false, hardy=false, forager=false;
  let phototax=false, guard=false, clock=false, hopper=false, pheromone=false;
  const traits = fly.isPlayer ? (fly.traits||[]) : (fly.rivalTraits||[]);
  traits.forEach(t=>{
    if(t==="white"){ senseMult*=1.25; nightPenalty=2; }
    else if(t==="curly"){ speed*=1.18; metab*=1.15; }
    else if(t==="vestigial"){ maxE+=60; metab*=0.9; gfJumpMult*=0.6; }
    else if(t==="ebony"){ predDmg*=0.7; senseMult*=0.88; }
    else if(t==="fecund"){ layCost*=0.78; fecund=true; }
    else if(t==="swift"){ dashCd*=0.70; swift=true; }
    else if(t==="hardy"){ metab*=0.84; speed*=0.92; hardy=true; }
    else if(t==="nocturnal") nocturnal=true;
    else if(t==="shaker") reflexBoost=true;
    else if(t==="forager"){ foodMult*=1.35; forager=true; }
    else if(t==="thrift") noOdor=true;
    else if(t==="tiger") tiger=true;
    else if(t==="giant"){ maxE+=60; gfThresh-=0.08; speed*=0.85; }
    else if(t==="rover"){ speed*=1.10; metab*=1.12; foodSenseMult*=1.20; rover=true; }
    else if(t==="sitter"){ speed*=0.90; foodMult*=1.25; sitter=true; }
    else if(t==="mimic") mimic=true;
    else if(t==="cannibal") cannibal=true;
    else if(t==="diapause") diapause=true;
    else if(t==="adh"){ adh=true; noOdor=true; speedTurn*=0.7; }
    else if(t==="phototax") phototax=true;
    else if(t==="guard") guard=true;
    else if(t==="clock") clock=true;
    else if(t==="hopper") hopper=true;
    else if(t==="pheromone") pheromone=true;
  });
  fly.stats={speed,metab,maxEnergy:maxE,senseMult,predDmg,layCost,dashCd,nocturnal,
    foodMult,noOdor,reflexBoost,tiger,gfThresh,
    fecund,swift,hardy,forager,
    foodSenseMult,nightPenalty,gfJumpMult,speedTurn,
    rover,sitter,mimic,cannibal,diapause,adh,phototax,guard,clock,hopper,pheromone};
  if(fly.energy>maxE) fly.energy=maxE;
}

export function makeFly(isPlayer, genes){
  const f={ isPlayer, x:0,y:0,vx:0,vy:0,angle:0, energy:100, alive:true, eggs:0,
    wanderAngle:rng()*Math.PI*2, genes:genes, trail:[], layCd:0, dashT:0, dashCdT:0,
    odorT:0, boostT:0, foodBoostT:0, pheromoneBoostT:0, pheromoneSite:null, kbCdT:0,
    gf:makeGFState() };
  if(isPlayer) f.traits=[]; else f.rivalTraits=[];
  recomputeStats(f);
  return f;
}

export function resetFly(fly, pos){
  fly.x=pos.x; fly.y=pos.y; fly.vx=0; fly.vy=0; fly.alive=true; fly.eggs=0; fly.trail=[];
  fly.layCd=LAY_CD; fly.dashT=0; fly.dashCdT=0; fly.odorT=0; fly.boostT=0; fly.foodBoostT=0; fly.pheromoneBoostT=0; fly.pheromoneSite=null; fly.kbCdT=0;
  fly.wanderAngle=rng()*Math.PI*2; recomputeStats(fly); fly.energy=fly.stats.maxEnergy;
}

// ---------- reproducible experiment: single-loom lead-time escape assay ----------
// Mirrors real looming-disk experiments: one strike per trial; escape succeeds only if GF
// fires with ≥ LEAD_NEEDED seconds of lead. ONLY difference between arms = connectivity.
export const EXP_LEAD_NEEDED = 0.18;
export function simEscapeTrial(mode, seed){
  let s=seed>>>0;
  const r=()=>{ s|=0; s=(s+0x6D2B79F5)|0; let t=Math.imul(s^(s>>>15),1|s); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; };
  const d0=0.75+r()*0.15, v0=0.10+r()*0.06, acc=0.9+r()*0.9;
  const dt=1/60; let d=d0, v=v0, prevTheta=0, fireT=-1, tStrike=-1;
  const gf=makeGFState();
  for(let t=0;t<8;t+=dt){
    v+=acc*dt; d-=v*dt; if(d<0.02) d=0.02;
    const theta=2*datan(GF.PRED_ANG_R/d);
    const vel=Math.max(0,(theta-prevTheta)/dt); prevTheta=theta;
    const size=(d>PRED_VISUAL)?0:theta, velv=(d>PRED_VISUAL)?0:vel;
    stepGF(gf, dt, { size, vel:velv, mode, leakRate:GF_PARAMS.LEAK_RATE_ASSAY });
    if(fireT<0 && gf.pot>=GF.THRESHOLD) fireT=t;
    if(d<=PRED_CATCH){ tStrike=t; break; }
  }
  if(tStrike<0) return {valid:false};
  const lead = fireT>=0 ? (tStrike-fireT) : -1;
  return {valid:true, escaped:(fireT>=0 && lead>=EXP_LEAD_NEEDED), lead};
}
export function runExperiment(worldSeed){
  const K=200; let er=0,es=0,n=0,leadR=0,leadS=0;
  for(let i=0;i<K;i++){ const sd=(worldSeed+i*7919)>>>0;
    const a=simEscapeTrial("real",sd), b=simEscapeTrial("shuffled",sd);
    if(!a.valid||!b.valid) continue; n++;
    if(a.escaped)er++; if(b.escaped)es++;
    leadR+=a.lead>0?a.lead:0; leadS+=b.lead>0?b.lead:0; }
  return { n, realEscape:100*er/n, shufEscape:100*es/n, realLead:leadR/n, shufLead:leadS/n };
}

// ============================== deterministic draft (ADDITIVE) ==============================
// The menu's Mutation Draft used Math.random, which made runs unreproducible:
// same seed, same score, different cards. These exports fix that without
// touching any pinned numerics above. draftCards is a pure function: the same
// (seed, gen, eggs, rivalEggs, owned) always draws the same three cards.
export function makeRng(seed){
  let a=(seed>>>0)||1;
  return function(){
    a|=0; a=(a+0x6D2B79F5)|0;
    let t=Math.imul(a^(a>>>15),1|a);
    t=(t+Math.imul(t^(t>>>7),61|t))^t;
    return ((t^(t>>>14))>>>0)/4294967296;
  };
}
export function draftSeed(worldSeed, gen, eggs, rivalEggs){
  // mix the run's outcome into the draft: your cards depend on how you got here
  return (worldSeed ^ Math.imul(gen,2654435761) ^ Math.imul(eggs,97) ^ Math.imul(rivalEggs,31))>>>0;
}
// The wild-type rival's gene weights, as a pure function of the world seed.
// Same draw order and ranges as GameScene.create() originally rolled from the
// shared stream (food .4-.9, threat .4-.9, light 0-.5, novelty .1-.6, forage
// .3-.8), on a private stream: for a given seed the values are bit-identical
// to what the old create()-time roll produced on a fresh profile. Determinism
// fix (dish/2): the browser used to roll rival genes ONCE from the page-load
// world seed and never re-roll them on seed changes (autopilot, bench,
// setSeed), so the "same" run depended on the visitor's localStorage.
export function rollRivalGenes(seed){
  const r=makeRng(seed);
  return { food:.4+r()*.5, threat:.4+r()*.5, light:r()*.5, novelty:.1+r()*.5, forage:.3+r()*.5 };
}
export function draftCards(worldSeed, gen, eggs, rivalEggs, owned){
  const r=makeRng(draftSeed(worldSeed,gen,eggs,rivalEggs));
  const ownedSet=new Set(owned||[]);
  const pool=[...STACKABLE];
  for(const t of NAMED_ONCE) if(!ownedSet.has(t)) pool.push(t);
  const chosen=[]; const copy=pool.slice();
  while(chosen.length<3&&copy.length){ chosen.push(copy.splice(Math.floor(r()*copy.length),1)[0]); }
  while(chosen.length<3) chosen.push(STACKABLE[Math.floor(r()*STACKABLE.length)]);
  return chosen;
}
