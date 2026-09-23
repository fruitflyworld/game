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
import { GF_PARAMS, makeGFState, stepGF, fireGF } from "./gf-neuron.js";
export { GF_PARAMS, gfChannels, gfPotential, makeGFState, stepGF, fireGF } from "./gf-neuron.js";
export const GF = { ...GF_PARAMS, PRED_ANG_R: 0.11 };
export const PRED_VISUAL = 0.8;

export const FOOD_TYPES = {
  sugar: { gain: 12, color: "food",     label: "糖" },
  yeast: { gain: 26, color: "gold",     label: "酵母" },
  rot:   { gain: 38, color: "lavender", label: "腐物" }
};
export const ODOR_TIME = 6;

export const TRAIT_INFO = {
  white:{name:"白眼 white", good:"感知范围 +25%", bad:"夜晚感知惩罚 ×2(白眼=夜视觉差)", eye:"#e8e2d0", src:"white 基因 · Morgan 1910(第一个遗传学突变)"},
  curly:{name:"卷翅 curly", good:"速度 +18%", bad:"代谢 +15%", src:"curly 翅形突变系"},
  vestigial:{name:"残翅 vestigial", good:"能量上限 +60,代谢 -10%", bad:"GF 起跳距离 -40%(残翅飞不起来)", syn:"配 巨型 giant = 坦克血统(站得住,跑不快)", src:"vestigial 残翅突变系"},
  ebony:{name:"黑檀 ebony", good:"捕食伤害 -30%", bad:"感知 -12%", body:"#3a3630", src:"ebony 体色突变系"},
  fecund:{name:"多产 fecund", good:"产卵消耗 -22%", bad:"产卵后气味暴露 2s", syn:"配 贪食 forager = 产卵引擎", src:"繁殖力性状"},
  swift:{name:"疾速 swift", good:"冲刺冷却 -30%", bad:"冲刺消耗 +40%", syn:"配 热颤 shaker = 连锁逃逸", src:"飞翔速度性状"},
  hardy:{name:"耐饥 hardy", good:"代谢 -16%", bad:"速度 -8%", src:"饥饿耐受性状"},
  nocturnal:{name:"夜视 nocturnal", good:"夜晚不再降感知", bad:"", syn:"配 虎纹 tiger = 夜间觅食;配 生物钟 clock = 昼夜双修", src:"昼夜活动多态性"},
  shaker:{name:"热颤 shaker", good:"GF 逃逸后 1.5s 内速度 +40%", bad:"", syn:"配 疾速 swift:逃逸后开溜", src:"shaker 震颤突变系(K+ 通道)"},
  forager:{name:"贪食 forager", good:"食物能量 +35%(可叠加)", bad:"进食后 1s 速度 -18%", syn:"配 多产 fecund:产卵引擎", src:"foraging 基因(漫游/安居位点)"},
  thrift:{name:"节俭 thrift", good:"吃腐物不再暴露气味", bad:"", syn:"解锁腐物农场:腐物+38 白吃;配 酒量 adh 双保险", src:"腐食耐受策略"},
  tiger:{name:"虎纹 tiger", good:"被咬时击退并震慑捕食者(冷却 8s)", bad:"", syn:"配 夜视:夜里抢腐物", src:"警戒色/反捕食行为"},
  giant:{name:"巨型 giant", good:"能量上限 +60,GF 反射更易触发", bad:"速度 -15%", syn:"配 耐饥 hardy:坦克血统", src:"体型性状"},
  rover:{name:"漫游 rover", good:"速度 +10%,食物感知 +20%", bad:"代谢 +12%,吃完的食物弹得更远", syn:"与 安居 sitter 互斥", src:"foraging 基因 rover 表型(真实多态)"},
  sitter:{name:"安居 sitter", good:"食物吃掉后原地刷新,进食效果 +25%", bad:"速度 -10%", syn:"与 漫游 rover 互斥 · 站桩流核心", src:"foraging 基因 sitter 表型(真实多态)"},
  mimic:{name:"拟态 mimic", good:"低速静止时捕食者丢失你(夜间无效)", bad:"静止时能量仍照扣", syn:"冻结战术,和 keep-moving 直觉对抗", src:"捕食者靠运动视觉捕猎(真实)"},
  cannibal:{name:"同类相食 cannibal", good:"贴近野生型时每秒吸它 2 能量,并使它减速 20%", bad:"吸食时你同时气味暴露", src:"果蝇幼虫同类相食(真实行为)"},
  diapause:{name:"滞育 diapause", good:"能量<30 时代谢 -60%,捕食者兴趣 -50%(假死)", bad:"滞育中速度 -40%、不能起跳", src:"滞育表型(真实逆境策略)"},
  adh:{name:"酒量 adh", good:"吃腐物不再气味暴露,且获得 4s 醉跑(速度 +25%)", bad:"醉跑期间转向迟钝(惯性偏转)", src:"乙醇脱氢酶 Adh 基因(腐物=发酵=酒精)"},
  phototax:{name:"趋光 phototax", good:"光照圈 0.3 内代谢 -30%(晒太阳回血)", bad:"夜晚被灯光持续吸引(躲不进黑暗)", syn:"与 夜视 nocturnal 分岔:日队 / 夜队", src:"趋光性行为 + 视运动回路(T4/T5)"},
  guard:{name:"护卵 guard", good:"守在自己卵堆边时,捕食者改为优先攻击野生型", bad:"捕食者路过卵堆会吃掉你的卵", src:"护卵行为(真实母性策略)"},
  clock:{name:"生物钟 clock", good:"白天代谢 -20%", bad:"夜晚代谢 +20%、感知 -10%", syn:"配 夜视 nocturnal = 昼夜双修;单拿 = 日行性 build", src:"period 基因 / LNv 时钟神经元(真实昼夜回路)"},
  hopper:{name:"跳跃者 hopper", good:"任意时刻可主动满质量起跳(不赌 GF 时机)", bad:"主动跳能量消耗 ×1.5、冷却 +50%", syn:"主动闪避流:对 GF 玩法影响最大的一张卡", src:"跳跃行为可塑性(逃逸程序的上调)"},
  pheromone:{name:"信息素 pheromone", good:"野生型产卵时你获提示,3s 内吃它产卵处的食物 +50%", bad:"你的产卵同样向它广播(同规则)", src:"表皮碳氢化合物信号(真实化学通讯)", syn:"信息战雏形:军备竞赛看得见"}
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
export function randomInDish(maxR=0.85){ const a=rng()*Math.PI*2, r=Math.sqrt(rng())*maxR; return {x:Math.cos(a)*r, y:Math.sin(a)*r}; }

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
    const theta=2*Math.atan(GF.PRED_ANG_R/d);
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
