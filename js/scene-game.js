// scene-game.js — the playable world. All sim logic ported from the validated prototype;
// rendering/juice rewritten on Phaser 3.
import {
  GEN_DURATION, CYCLE_SEC, FOOD_RADIUS, FOOD_SENSE, THREAT_SENSE, NOVELTY_SENSE, GRID_N, FOOD_COUNT,
  LAY_THRESHOLD, LAY_COST, LAY_CD, DASH_SPEED, DASH_TIME, DASH_CD, DASH_COST,
  PRED_BASE, PRED_LUNGE, PRED_LUNGE_RANGE, PRED_CATCH, PRED_DPS,
  GF, PRED_VISUAL, FOOD_TYPES, ODOR_TIME, TRAIT_INFO, NAMED_ONCE, STACKABLE, draftCards,
  clamp01, dist, normalize, rng, seedRng, randomInDish, rollRivalGenes,
  recomputeStats, makeFly, resetFly,
  GF_PARAMS, stepGF, fireGF, makeGFState
} from "./sim.js";
import { createCircuitBrain } from "./brain-circuit.js";
import { createLocalBrain } from "./brain-local.js";
import { createJevBrain, JEV_MODEL_DEFAULT } from "./brain-jev.js";
import { createBrainDriver } from "./brain-driver.js";
import { tr } from "./ui.js";
import { contentHash } from "./brain.js";
import { sfx } from "./audio.js";

const SAVE_KEY="flyline_v1";
const COL={ teal:0x4fd8b8, egg:0xf2d98a, gold:0xe8b64c, lavender:0xb49ae8, food:0x7ed957, red:0xa8394a, white:0xffffff };
const CSS={ teal:"#4fd8b8", egg:"#f2d98a", gold:"#e8b64c", lavender:"#b49ae8", food:"#7ed957", red:"#ff7a8f", dim:"#9db4ab" };

export class GameScene extends Phaser.Scene {
  constructor(){ super("Game"); }

  // ============================== create ==============================
  create(){
    const W=this.scale.gameSize.width, H=this.scale.gameSize.height;
    this.W=W; this.H=H;
    this.R=W>=800?310:Math.floor(W/2)-10; // portrait phones: dish nearly fills canvas width
    this.C={x:W/2,y:H/2};
    this.cameras.main.setBackgroundColor("#070a09");

    this.loadState();
    seedRng(this.state.worldSeed);

    // ---- static scenery ----
    this.makeScenery();
    this.nightOverlay=this.add.circle(this.C.x,this.C.y,this.R+8,0x0a1030,0).setDepth(4);

    // ---- dynamic world objects ----
    this.eggsGroup=this.add.group();
    this.foodSprites=[];
    this.trailG=this.add.graphics().setDepth(6);

    this.playerFly=makeFly(true, {food:.6,threat:.7,light:.3,novelty:.4,forage:.5});
    this.playerFly.traits=this.state.ownedTraits;
    this.rivalFly=makeFly(false, rollRivalGenes(this.state.worldSeed));
    this.rivalFly.rivalTraits=this.state.rivalTraits;
    this.flies=[this.playerFly,this.rivalFly];

    this.flyView={};
    this.flies.forEach(f=>{
      const cont=this.add.container(0,0).setDepth(f.isPlayer?12:10);
      const body=this.add.image(0,0,f.isPlayer?"fly-p":"fly-r").setScale(0.72);
      const wingL=this.add.image(-6,-3,"wing").setScale(0.6).setAlpha(.85);
      const wingR=this.add.image(6,-3,"wing").setScale(-0.6,0.6).setAlpha(.85);
      cont.add([wingL,wingR,body]);
      cont.setScale(f.isPlayer?1.15:1.0);
      this.flyView[f.isPlayer?"p":"r"]={cont,body,wingL,wingR};
    });
    this.stinkP={p:null,r:null};

    this.predator={x:0,y:0,vx:0,vy:0,angle:0,alive:true,legPhase:0,phase:"approach",lungeDir:{x:0,y:0},lungeT:0,recoverT:0,target:null};
    this.spiderCont=this.add.container(0,0).setDepth(11);
    this.spiderLegs=this.add.graphics();
    this.spiderBody=this.add.image(0,0,"spider").setScale(0.9);
    this.spiderCont.add([this.spiderLegs,this.spiderBody]);

    // ---- particles ----
    this.makeEmitters();

    // ---- input ----
    this.keys=this.input.keyboard.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE");
    this.input.keyboard.on("keydown-SPACE",()=>this.tryDash(this.playerFly));
    this.pointerTarget=null;
    this.input.on("pointerdown",p=>{ if(!this.isTouch) this.pointerTarget=this.pxToWorld(p.x,p.y); });
    this.input.on("pointermove",p=>{ if(p.isDown&&!this.isTouch) this.pointerTarget=this.pxToWorld(p.x,p.y); });
    this.input.on("pointerup",()=>{ this.pointerTarget=null; });
    this.isTouch=false; // ui.js wireTouch() sets this to true on touch devices

    // ---- runtime state ----
    this.running=false; this.started=false; this.ended=false;
    this.simTime=0; this.genElapsed=0; this.genTimeLeft=GEN_DURATION; this.nightFactor=0;
    this.food=[]; this.slowmoT=0; this.dangerFlash=0; this.gfWasArmed=false;
    this.visitedCells=new Set();
    this.driveMode="manual"; this.touchVec=null; this.agentVec=null; this.agentVecTime=0;
    // death-replay ring buffer: last ~6s of entity poses. Visual only — never read by the sim.
    this.replayBuf=[]; this.replaying=false; this.replayT=0; this.replayFrames=null; this.replayDone=null;

    this.resetGenerationWorld();

    // ---- brain selection (the fly's decision layer) ----
    this.brainLog=[]; this.lastBrainBehavior="explore";
    this.brainDriver=null; this.judgmentFallback=null; this.judgmentWarned=false;
    this.playerBrainId=this.state.brainId||"manual";
    this.attachBrain(this.playerBrainId,{silent:true});

    // agent API (same arena, same rules)
    window.FlyLabAPI={
      getState:()=>({ x:this.playerFly.x, y:this.playerFly.y, energy:this.playerFly.energy,
        maxEnergy:this.playerFly.stats.maxEnergy, timeLeft:this.genTimeLeft, eggs:this.playerFly.eggs,
        night:this.nightFactor, dashReady:this.playerFly.dashCdT<=0, gf:this.playerFly.gf.pot, gfArmed:this.playerFly.gf.armed,
        food:this.food.map(f=>({x:f.x,y:f.y,type:f.type})),
        predator:this.predator.alive?{x:this.predator.x,y:this.predator.y,phase:this.predator.phase}:null,
        rivalEggs:this.rivalFly.eggs, mode:this.driveMode, alive:this.playerFly.alive }),
      setControl:v=>{ if(v){ this.agentVec={x:v.x||0,y:v.y||0}; this.agentVecTime=performance.now(); } },
      dash:()=>this.tryDash(this.playerFly),
      setMode:m=>{ if(["manual","auto","agent"].includes(m)) this.driveMode=m; },
      setBrain:id=>this.attachBrain(id),
      getBrain:()=>({ id:this.playerBrainId, model:this.brainDriver?this.brainDriver.model:null }),
      getDecisionLog:()=>({ version:"flyline-log/1", worldSeed:this.state.worldSeed,
        genNumber:this.state.genNumber, brain:{ id:this.playerBrainId,
        model:this.brainDriver?this.brainDriver.model:"player" }, records:this.brainLog.slice() }),
      downloadDecisionLog:()=>this.downloadDecisionLog(),
      autopilot:o=>this.autopilot(o),
      importQuests:s=>this.importQuests(s)
    };
  }

  // ============================== brain layer ==============================
  // The brain only chooses a direction each decision tick; the GF brainstem
  // (gf-neuron.js + tryDash) still owns the physical escape jump.
  attachBrain(id,opts){
    if(!["manual","genes","circuit","judgment"].includes(id)) return;
    const prev=this.playerBrainId;
    this.playerBrainId=id; this.state.brainId=id;
    this.brainLog=[]; this.lastBrainBehavior="explore";
    this.judgmentWarned=false;
    if(id==="circuit"){
      const brain=createCircuitBrain({seed:(this.state.worldSeed^0xC0FFEE)>>>0});
      this.brainDriver=createBrainDriver({
        brain, intervalSec:0.1,
        onError:()=>this.onBrainError()
      });
    } else if(id==="judgment"){
      const key=localStorage.getItem("flyline_jev_key");
      if(key){
        // remote System One brain; any failure falls back to the local heuristic
        try{
          const remote=createJevBrain({apiKey:key, model:JEV_MODEL_DEFAULT});
          const local=createLocalBrain();
          this.judgmentFallback=local;
          this.brainDriver=createBrainDriver({
            brain:remote, intervalSec:1.0,
            onError:()=>this.fallbackToJudgmentLocal()
          });
        }catch(e){ this.attachJudgmentLocal(); }
      } else this.attachJudgmentLocal(true);
    } else this.brainDriver=null;
    // brains other than manual drive themselves; GF reflex auto-fires (updateFly)
    if(id!=="manual") this.driveMode="auto";
    else if(this.driveMode==="auto") this.driveMode="manual";
    this.saveState();
    this.refreshBrainHud();
    if(!opts||!opts.silent){
      this.uiLog(id==="manual"?tr("Brain: MANUAL — you drive (WASD + Space).","大脑:手动 —— 你来开(WASD + 空格)。")
        :id==="genes"?tr("Brain: GENES — gene-weighted auto-pilot.","大脑:基因 —— 基因加权自动驾驶。")
        :id==="circuit"?tr("Brain: CIRCUIT — FFW-CX/0.1, 24 spiking neurons.","大脑:回路 —— FFW-CX/0.1,24 个脉冲神经元。")
        :(this.brainDriver&&this.brainDriver.model!==("local-heuristic/0.1")
          ?tr("Brain: JUDGMENT — ","大脑:判断 —— ")+this.brainDriver.model+tr(" via /api/jev.","（经 /api/jev 代理）。")
          :tr("Brain: JUDGMENT — local-heuristic/0.1 (no key set; free offline).","大脑:判断 —— local-heuristic/0.1（未设 key,免费离线）。")));
      if(prev!==id) sfx.uiTick();
    }
    document.dispatchEvent(new CustomEvent("flyline:brain",{detail:{
      id, model:this.brainDriver?this.brainDriver.model:null }}));
  }
  attachJudgmentLocal(silent){
    this.judgmentFallback=null;
    this.brainDriver=createBrainDriver({
      brain:createLocalBrain(), intervalSec:0.5, onError:()=>this.onBrainError()
    });
    if(!silent) this.refreshBrainHud();
  }
  fallbackToJudgmentLocal(){
    // remote brain failed (529, timeout, bad key): swap in the local heuristic,
    // keep the decision cadence going. Visible chip change + one-time warning.
    if(!this.judgmentFallback) return;
    if(!this.judgmentWarned){
      this.judgmentWarned=true;
      this.uiLog(tr("Judgment model unreachable — fell back to local-heuristic/0.1. Check your key or the /api/jev proxy.","判断模型不可达 —— 已切换 local-heuristic/0.1。检查你的 key 或 /api/jev 代理。"));
    }
    const tick=this.brainDriver?this.brainDriver.last:null;
    this.brainDriver=createBrainDriver({
      brain:this.judgmentFallback, intervalSec:0.5, onError:()=>this.onBrainError()
    });
    this.refreshBrainHud();
  }
  computeSignals(fly){
    const f=this.findNearestFood(fly), th=this.findThreat(fly), l=this.lightSignal(fly);
    // novelty: share of unvisited cells in the 3x3 neighborhood
    const key=this.cellKeyOf(fly).split(",");
    const i0=+key[0], j0=+key[1];
    let unvis=0,total=0;
    for(let di=-1;di<=1;di++)for(let dj=-1;dj<=1;dj++){
      const i=i0+di,j=j0+dj;
      if(i<0||j<0||i>=GRID_N||j>=GRID_N) continue;
      total++;
      if(!this.visitedCells.has(i+","+j)) unvis++;
    }
    return { food:f?f.signal:0, threat:th?th.signal:0, light:l.signal, novelty:total?unvis/total:0 };
  }
  brainSteer(fly){
    const d=this.brainDriver?this.brainDriver.last:null;
    const beh=d?d.behavior:"explore";
    if(beh==="freeze") return {x:0,y:0};
    if(beh==="avoid"){ const th=this.findThreat(fly); if(th) return th.dirAway; }
    if(beh==="approach"){ const f=this.findNearestFood(fly); if(f) return f.dir; }
    fly.wanderAngle+=(rng()-0.5)*0.5;
    return normalize({x:Math.cos(fly.wanderAngle),y:Math.sin(fly.wanderAngle)});
  }
  updateBrain(dt){
    if(!this.brainDriver) return;
    this.brainDriver.update(this.simTime,dt,
      ()=>({ signals:this.computeSignals(this.playerFly), energy:this.playerFly.energy,
             timeLeft:this.genTimeLeft, behavior:this.lastBrainBehavior }),
      res=>{
        this.lastBrainBehavior=res.behavior;
        this.brainLog.push(res.record);
        if(this.brainLog.length>2000) this.brainLog.shift();
        this.refreshBrainHud(res);
      });
  }
  onBrainError(){
    this.uiLog(tr("Brain error — steering falls back to genes until it recovers.","大脑出错 —— 转向暂时回落到基因模式,恢复后自动切回。"));
  }
  downloadDecisionLog(){
    const payload=window.FlyLabAPI.getDecisionLog();
    const blob=new Blob([JSON.stringify(payload,null,1)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="flyline-log-seed"+payload.worldSeed+"-gen"+payload.genNumber+".json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),5000);
    return payload.records.length;
  }
  refreshBrainHud(res){
    const q=id=>document.getElementById(id);
    const panel=q("brainPanel"); if(!panel) return;
    const active=!!this.brainDriver;
    panel.hidden=!active;
    if(!active) return;
    q("hBrainModel").textContent=this.brainDriver.model;
    if(res){
      q("hBrainConf").textContent="conf "+res.confidence.toFixed(2)+" · tick "+res.record.tick;
      const map={approach:"hBmApproach",avoid:"hBmAvoid",explore:"hBmExplore",freeze:"hBmFreeze"};
      for(const k in map){
        const el=q(map[k]);
        el.style.width=Math.round(Math.max(0,Math.min(1,res.record.distribution[k]))*100)+"%";
        el.parentElement.parentElement.classList.toggle("lead",res.behavior===k);
      }
      const dg=q("hDanger");
      if(dg){
        const d=Math.max(0,Math.min(3,res.record.dangerScore||0));
        dg.textContent="▮".repeat(Math.round(d))+"▯".repeat(3-Math.round(d))+" "+d.toFixed(1);
        dg.className=d>=2?"c-red":d>=1?"c-gold":"c-teal";
      }
    }
  }

  // ============================== state / persistence ==============================
  loadState(){
    let s=null; try{ s=JSON.parse(localStorage.getItem(SAVE_KEY)); }catch(e){}
    this.state={
      genNumber:(s&&s.genNumber)||1,
      ownedTraits:(s&&s.traits)||[],
      rivalTraits:(s&&s.rivalTraits)||[],
      worldSeed:(s&&s.worldSeed)||1337,
      connectivityMode:(s&&s.connectivityMode)||"real",
      lineageEggs:(s&&s.lineageEggs)||0,
      bestEggs:(s&&s.bestEggs)||0,
      eggsHistory:(s&&s.eggsHistory)||[],
      brainId:(s&&s.brainId)||"manual"
    };
    this.savedRivalSnapshot=Array.isArray(this.state.rivalTraits)?null:this.state.rivalTraits;
  }
  saveState(){
    try{ localStorage.setItem(SAVE_KEY, JSON.stringify({
      genNumber:this.state.genNumber, traits:this.state.ownedTraits,
      rivalTraits:this.rivalFly.rivalTraits, worldSeed:this.state.worldSeed,
      connectivityMode:this.state.connectivityMode, lineageEggs:this.state.lineageEggs,
      bestEggs:this.state.bestEggs, eggsHistory:this.state.eggsHistory, brainId:this.playerBrainId
    })); }catch(e){}
  }
  getStats(){ return { ...this.state, rivalCount:this.rivalFly.rivalTraits.length }; }
  wipeSave(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }

  // ============================== scenery ==============================
  makeScenery(){
    const g=this.add.graphics().setDepth(1);
    // bench vignette
    const bg=g; bg.fillStyle(0x0b100e,1); bg.fillRect(0,0,this.W,this.H);
    // dish agar gradient (canvas texture for real gradient)
    if(!this.textures.exists("agar")){
      const tex=this.textures.createCanvas("agar",this.R*2+16,this.R*2+16);
      const c=tex.getContext(), R=this.R+8, cx=R, cy=R;
      const gr=c.createRadialGradient(cx,cy,R*0.1,cx,cy,R);
      gr.addColorStop(0,"#12221d"); gr.addColorStop(.8,"#0e1a16"); gr.addColorStop(1,"#0a1310");
      c.fillStyle=gr; c.beginPath(); c.arc(cx,cy,R,0,Math.PI*2); c.fill();
      tex.refresh();
    }
    this.add.image(this.C.x,this.C.y,"agar").setDepth(2);
    // glass rim
    const rim=this.add.graphics().setDepth(3);
    rim.lineStyle(5,0xdfeee8,0.16); rim.strokeCircle(this.C.x,this.C.y,this.R+5);
    rim.lineStyle(1.5,0xffffff,0.28); rim.strokeCircle(this.C.x,this.C.y,this.R+8);
    rim.lineStyle(1,0xffffff,0.05); rim.strokeCircle(this.C.x,this.C.y,this.R+14);
    // measurement rings + crosshair (bio-lab)
    const meas=this.add.graphics().setDepth(3); meas.lineStyle(1,0x4fd8b8,0.07);
    [0.33,0.66].forEach(f=>meas.strokeCircle(this.C.x,this.C.y,this.R*f));
    meas.lineStyle(1,0x4fd8b8,0.05);
    meas.lineBetween(this.C.x-this.R,this.C.y,this.C.x+this.R,this.C.y);
    meas.lineBetween(this.C.x,this.C.y-this.R,this.C.x,this.C.y+this.R);
    // light source glow
    this.lightGlow=this.add.image(0,0,"glow").setScale(this.R/32).setDepth(5);
  }

  makeEmitters(){
    const mk=tint=>this.add.particles(0,0,"dot",{
      speed:{min:40,max:150}, angle:{min:0,max:360}, lifespan:{min:250,max:600},
      scale:{start:.9,end:0}, quantity:12, emitting:false, tint
    }).setDepth(9);
    this.emFood=mk(COL.food); this.emGold=mk(COL.gold); this.emLav=mk(COL.lavender);
    this.emEgg=mk(COL.egg); this.emRed=mk(COL.red); this.emTeal=mk(COL.teal);
  }

  // ============================== coordinate helpers ==============================
  toPx(x,y){ return {x:this.C.x+x*this.R, y:this.C.y+y*this.R}; }
  pxToWorld(px,py){ return {x:(px-this.C.x)/this.R, y:(py-this.C.y)/this.R}; }

  // ============================== world gen (seeded, reproducible) ==============================
  resetGenerationWorld(){
    const gen=this.state.genNumber;
    seedRng(this.state.worldSeed + gen*2654435761);
    this.food=[];
    const nSugar=Math.max(4,FOOD_COUNT-Math.floor((gen-1)/2)), nYeast=2+Math.floor(gen/4), nRot=2+Math.floor(gen/5);
    for(let i=0;i<nSugar;i++){ const p=randomInDish(0.85); this.food.push({x:p.x,y:p.y,type:"sugar"}); }
    for(let i=0;i<nYeast;i++){ const a=rng()*Math.PI*2, r=0.72+rng()*0.2; this.food.push({x:Math.cos(a)*r,y:Math.sin(a)*r,type:"yeast"}); }
    for(let i=0;i<nRot;i++){ const p=randomInDish(0.85); this.food.push({x:p.x,y:p.y,type:"rot"}); }

    this.eggsGroup.clear(true,true);
    this.genTimeLeft=GEN_DURATION; this.genElapsed=0; this.nightFactor=0; this.ended=false;
    // fresh brain each generation: neuron state and decision log start clean
    this.brainLog=[]; this.lastBrainBehavior="explore"; this.escapesThisGen=0; this.replayBuf=[];
    if(this.brainDriver) this.brainDriver.reset();

    this.playerFly.traits=this.state.ownedTraits;
    resetFly(this.playerFly,{x:0,y:0});
    this.playerFly.deathReason="";
    // determinism fix (dish/2): the wild type's genes are a pure function of
    // the world seed — re-derived here so autopilot/bench/setSeed runs stop
    // depending on genes rolled at page-load time from the visitor's save.
    this.rivalFly.genes=rollRivalGenes(this.state.worldSeed);
    // rival arms race: restores saved build, drafts ONE mutation per gen (deterministic)
    if(this.savedRivalSnapshot){ this.rivalFly.rivalTraits=this.savedRivalSnapshot.slice(); this.savedRivalSnapshot=null; }
    const poolR=NAMED_ONCE.concat(STACKABLE).filter(t=>STACKABLE.includes(t)||!this.rivalFly.rivalTraits.includes(t));
    if(poolR.length&&gen>1){
      const pick=poolR[Math.floor(rng()*poolR.length)];
      this.rivalFly.rivalTraits.push(pick);
      this.uiLog(`🧬 `+tr(`Wild type evolved: ${pick}`,`野生型进化:${TRAIT_INFO[pick]?TRAIT_INFO[pick].name.split(" ")[0]:pick}`));
    }
    resetFly(this.rivalFly,randomInDish(0.5));

    const pp=randomInDish(0.9);
    Object.assign(this.predator,{x:pp.x,y:pp.y,vx:0,vy:0,alive:true,phase:"approach",lungeT:0,recoverT:0});
    this.running=true;

    this.rebuildFoodSprites();
    this.saveState();
    document.dispatchEvent(new CustomEvent("flyline:genstart",{detail:{gen}}));
  }

  rebuildFoodSprites(){
    this.foodSprites.forEach(s=>s.destroy()); this.foodSprites=[];
    this.food.forEach((f,i)=>{
      const p=this.toPx(f.x,f.y);
      const spr=this.add.image(p.x,p.y,"food-"+f.type).setDepth(8);
      this.tweens.add({ targets:spr, scale:{from:0.92,to:1.1}, duration:900+rngUse(i)*500, yoyo:true, repeat:-1, ease:"Sine.inOut" });
      this.foodSprites.push(spr);
    });
  }

  relocateFood(item, fly){
    if(fly.stats.sitter){ return; }
    const roverFactor=fly.stats.rover?0.15:0;
    if(item.type==="yeast"){ const a=rng()*Math.PI*2, rr=0.72+rng()*0.2+roverFactor; item.x=Math.cos(a)*Math.min(0.94,rr); item.y=Math.sin(a)*Math.min(0.94,rr); }
    else { const p=randomInDish(Math.min(0.94,0.85+roverFactor)); item.x=p.x; item.y=p.y; }
    const i=this.food.indexOf(item); const spr=this.foodSprites[i]; const p=this.toPx(item.x,item.y);
    spr.setPosition(p.x,p.y);
  }

  // ============================== fly logic (ported) ==============================
  senseScale(fly){
    let s=fly.stats.senseMult;
    if(!fly.stats.nocturnal) s*=(1-0.3*this.nightFactor);
    if(fly.stats.nightPenalty>1) s/=1+(fly.stats.nightPenalty-1)*this.nightFactor;
    if(fly.stats.clock&&this.nightFactor>0.5) s*=0.9;
    return s;
  }
  findNearestFood(fly){
    let best=null,bd=Infinity;
    for(const f of this.food){ const d=dist(fly,f); if(d<bd){bd=d;best=f;} }
    const sense=FOOD_SENSE*this.senseScale(fly)*fly.stats.foodSenseMult;
    if(!best||bd>sense) return null;
    return {dir:normalize({x:best.x-fly.x,y:best.y-fly.y}), signal:1-bd/sense};
  }
  findThreat(fly){
    if(!this.predator.alive) return null;
    const d=dist(fly,this.predator), sense=THREAT_SENSE*this.senseScale(fly);
    if(fly.stats.diapause&&fly.energy<30&&d>0.18) return null;
    if(fly.stats.mimic&&fly.vx*fly.vx+fly.vy*fly.vy<0.004&&this.nightFactor<0.7) return null;
    if(d>sense) return null;
    return {dirAway:normalize({x:fly.x-this.predator.x,y:fly.y-this.predator.y}),signal:1-d/sense,d};
  }
  lightSignal(fly){
    const lp=this.lightPos();
    const d=dist(fly,lp), signal=clamp01(1-d/1.4);
    if(signal<=0.02) return {signal:0,dir:{x:0,y:0}};
    return {signal,dir:normalize({x:lp.x-fly.x,y:lp.y-fly.y})};
  }
  lightPos(){
    const a=this.genElapsed/CYCLE_SEC*Math.PI*2;
    return {x:Math.cos(a)*0.5, y:Math.sin(a)*0.5};
  }
  cellKeyOf(p){
    const i=Math.min(GRID_N-1,Math.max(0,Math.floor((p.x+1)/2*GRID_N)));
    const j=Math.min(GRID_N-1,Math.max(0,Math.floor((p.y+1)/2*GRID_N)));
    return i+","+j;
  }

  decideSteer(fly){
    const s={x:0,y:0};
    const f=this.findNearestFood(fly);
    if(f){ const w=fly.genes.food*(0.6+0.8*fly.genes.forage); s.x+=f.dir.x*w*f.signal; s.y+=f.dir.y*w*f.signal; }
    const th=this.findThreat(fly);
    if(th){ s.x+=th.dirAway.x*fly.genes.threat*1.6*th.signal; s.y+=th.dirAway.y*fly.genes.threat*1.6*th.signal; }
    const l=this.lightSignal(fly);
    if(l.signal>0){ s.x+=l.dir.x*fly.genes.light*l.signal; s.y+=l.dir.y*fly.genes.light*l.signal; }
    fly.wanderAngle+=(rng()-0.5)*0.5;
    s.x+=Math.cos(fly.wanderAngle)*0.12; s.y+=Math.sin(fly.wanderAngle)*0.12;
    return normalize(s);
  }
  getSteer(fly){
    // external agent API always wins when fresh
    if(fly.isPlayer&&this.driveMode==="agent"&&this.agentVec&&(performance.now()-this.agentVecTime)<500) return normalize(this.agentVec);
    // selected brain (CIRCUIT/JUDGMENT) steers the player fly
    if(fly.isPlayer&&this.brainDriver) return this.brainSteer(fly);
    if(fly.isPlayer&&this.driveMode==="manual"){
      if(this.touchVec) return normalize(this.touchVec);
      if(this.pointerTarget){ const v={x:this.pointerTarget.x-fly.x,y:this.pointerTarget.y-fly.y};
        if(Math.hypot(v.x,v.y)<0.02) return {x:0,y:0}; return normalize(v); }
      let x=0,y=0; const k=this.keys;
      if(k.A.isDown||k.LEFT.isDown)x-=1; if(k.D.isDown||k.RIGHT.isDown)x+=1;
      if(k.W.isDown||k.UP.isDown)y-=1; if(k.S.isDown||k.DOWN.isDown)y+=1;
      if(x||y) return normalize({x,y});
      return {x:0,y:0};
    }
    const steer=this.decideSteer(fly);
    if(fly.stats.phototax&&this.nightFactor>0.5){
      const light=this.lightSignal(fly);
      return normalize({x:steer.x*0.75+light.dir.x*0.25,y:steer.y*0.75+light.dir.y*0.25});
    }
    return steer;
  }

  // Environment input + time advance only. The neural state transition lives in
  // gf-neuron.js (stepGF); the escape behavior lives in tryDash.
  updateGF(fly,dt){
    const g=fly.gf;
    let size=0,vel=0;
    if(this.predator.alive){
      const d=Math.max(0.02,dist(fly,this.predator));
      const theta=2*Math.atan(GF.PRED_ANG_R/d);
      vel=Math.max(0,(theta-g.prevTheta)/Math.max(dt,1e-3));
      g.prevTheta=theta;
      if(d<=PRED_VISUAL){ size=theta; }
    } else g.prevTheta=0;
    stepGF(g, dt, {
      size, vel, mode:this.state.connectivityMode,
      threshold:fly.stats.gfThresh, leakRate:GF_PARAMS.LEAK_RATE_GAME,
      now:this.simTime, refractory:fly.stats.dashCd*0.5
    });
    if(g.iframe>0) g.iframe=Math.max(0,g.iframe-dt);
  }

  tryDash(fly){
    if(!fly.alive||fly.dashCdT>0) return;
    const reflex=fly.gf.armed;
    const hopper=fly.stats.hopper&&!reflex;
    if(!reflex&&!hopper) return;
    if(hopper&&fly.isPlayer) this.uiLog(tr("Hopper: active escape costs more energy.","跳跃者:主动起跳消耗更多能量。"));
    const cost=reflex?DASH_COST*0.6:DASH_COST*1.5;
    const finalCost=fly.stats.swift&&!reflex?cost*1.4:cost;
    if(fly.energy<finalCost) return;
    fly.dashT=reflex?DASH_TIME*1.5:DASH_TIME*0.7; fly.dashCdT=fly.stats.dashCd*(hopper?1.5:1); fly.energy-=cost;
    fly.energy-=finalCost-cost;
    fireGF(fly.gf, this.simTime);
    if(reflex){
      fly.gf.iframe=0.18;
      if(fly.stats.reflexBoost) fly.boostT=1.5;
      if(this.predator.alive){
        const a=normalize({x:fly.x-this.predator.x,y:fly.y-this.predator.y});
        const b=DASH_SPEED*fly.stats.speed*1.1*fly.stats.gfJumpMult;
        fly.vx+=a.x*b; fly.vy+=a.y*b;
      }
      if(fly.isPlayer){
        this.escapesThisGen=(this.escapesThisGen||0)+1;
        sfx.dash(); this.floater(fly,"GF ESCAPE!",CSS.teal);
        const p=this.toPx(fly.x,fly.y); this.emTeal.explode(14,p.x,p.y);
        this.squash(fly);
        // after-image
        const ghost=this.add.image(p.x,p.y,fly.isPlayer?"fly-p":"fly-r").setScale(0.8).setAlpha(0.5).setDepth(7).setRotation(this.flyView.p.cont.rotation);
        this.tweens.add({targets:ghost,alpha:0,scale:0.5,duration:320,onComplete:()=>ghost.destroy()});
      }
    } else if(fly.isPlayer){ sfx.dash(); this.squash(fly); }
  }
  squash(fly){
    const v=this.flyView[fly.isPlayer?"p":"r"], c=v.cont;
    this.tweens.add({targets:c,scaleX:(fly.isPlayer?1.15:1)*1.45,scaleY:(fly.isPlayer?1.15:1)*0.6,duration:70,yoyo:true,ease:"Quad.out"});
  }

  // ============================== death replay (visual only) ==============================
  // Poses the entities along the recorded ring buffer at half speed while the
  // generation-end modal waits. No sim state is touched; bench mode never enters.
  playDeathReplay(onDone){
    if(this.__bench||this.replaying||this.replayBuf.length<30){ if(onDone) onDone(); return; }
    this.replayFrames=this.replayBuf.slice(); this.replayT=0; this.replaying=true; this.replayDone=onDone||null;
    document.dispatchEvent(new CustomEvent("flyline:replay",{detail:{sec:(this.replayFrames.length/60).toFixed(1)}}));
  }
  stepReplay(dtReal){
    const F=this.replayFrames;
    this.replayT+=dtReal*0.5; // half speed
    const i=Math.min(F.length-1,Math.floor(this.replayT*60));
    const f=F[i];
    const pose=(v,o)=>{ const p=this.toPx(o.x,o.y); v.cont.setPosition(p.x,p.y).setRotation(o.a+Math.PI/2); v.cont.setVisible(true); };
    pose(this.flyView.p,f.p);
    if(f.r.alive) pose(this.flyView.r,f.r); else this.flyView.r.cont.setVisible(false);
    const sp=this.toPx(f.e.x,f.e.y);
    this.spiderCont.setVisible(true).setPosition(sp.x,sp.y).setRotation(f.e.a);
    this.spiderBody.setScale(0.9*(f.e.lunge?1.15:1));
    this.spiderCont.setDepth(f.e.lunge?13:11);
    this.spiderLegs.clear(); this.spiderLegs.lineStyle(2.5,0xc83c50,0.85);
    for(let k=0;k<4;k++){
      const a=0.5+k*0.4, off=Math.sin(this.replayT*28+k)*5;
      this.spiderLegs.lineBetween(0,0,Math.cos(a)*42,Math.sin(a)*42+off);
      this.spiderLegs.lineBetween(0,0,Math.cos(-a)*42,Math.sin(-a)*42-off);
    }
    if(i>=F.length-1){
      this.replaying=false;
      const cb=this.replayDone; this.replayDone=null; this.replayFrames=null;
      document.dispatchEvent(new CustomEvent("flyline:replaydone"));
      if(cb) cb();
    }
  }

  updateFly(fly,dt){
    if(!fly.alive) return;
    fly.layCd=Math.max(0,fly.layCd-dt); fly.dashCdT=Math.max(0,fly.dashCdT-dt); fly.dashT=Math.max(0,fly.dashT-dt);
    fly.odorT=Math.max(0,fly.odorT-dt); fly.boostT=Math.max(0,fly.boostT-dt); fly.foodBoostT=Math.max(0,(fly.foodBoostT||0)-dt); fly.pheromoneBoostT=Math.max(0,(fly.pheromoneBoostT||0)-dt); fly.cannibalSlowT=Math.max(0,(fly.cannibalSlowT||0)-dt); fly.kbCdT=Math.max(0,fly.kbCdT-dt);
    this.updateGF(fly,dt);
    if(!(fly.isPlayer&&this.driveMode==="manual")&&fly.gf.armed) this.tryDash(fly);
    const steerRaw=this.getSteer(fly);
    const steer=fly.stats.adh&&fly.boostT>0?normalize({
      x:steerRaw.x*fly.stats.speedTurn+Math.cos(fly.angle)*(1-fly.stats.speedTurn),
      y:steerRaw.y*fly.stats.speedTurn+Math.sin(fly.angle)*(1-fly.stats.speedTurn)
    }):steerRaw;
    const inDiapause=fly.stats.diapause&&fly.energy<30;
    const diapauseSlow=inDiapause?0.6:1;
    const diapauseMetab=inDiapause?0.4:1;
    if(fly.isPlayer&&inDiapause&&!fly._diapauseNotified){ this.floater(fly,tr("Diapause: energy saving","滞育:节能中"),CSS.violet||CSS.lavender); this.uiLog(tr("Diapause active: lower metabolism, slower movement.","滞育激活:代谢降低,移动变慢。")); fly._diapauseNotified=true; }
    if(!inDiapause) fly._diapauseNotified=false;
    const adhSlow=fly.stats.adh&&fly.boostT>0?0.72:1;
    const foragerSlow=fly.stats.forager&&fly.foodBoostT>0?0.82:1;
    const cannibalSlow=fly.cannibalSlowT>0?0.8:1;
    const spd=fly.stats.speed*diapauseSlow*adhSlow*foragerSlow*cannibalSlow*(fly.dashT>0?DASH_SPEED:1)*(fly.boostT>0?1.4:1);
    fly.vx+=(steer.x*spd-fly.vx)*Math.min(1,dt*12); fly.vy+=(steer.y*spd-fly.vy)*Math.min(1,dt*12);
    fly.x+=fly.vx*dt; fly.y+=fly.vy*dt;
    const r=Math.hypot(fly.x,fly.y);
    if(r>0.96){ fly.x=fly.x/r*0.96; fly.y=fly.y/r*0.96; fly.vx*=-0.3; fly.vy*=-0.3; }
    if(Math.hypot(fly.vx,fly.vy)>0.01) fly.angle=Math.atan2(fly.vy,fly.vx);
    if(fly.isPlayer) this.visitedCells.add(this.cellKeyOf(fly));
    fly.trail.push({x:fly.x,y:fly.y}); if(fly.trail.length>26) fly.trail.shift();
    const phototaxMetab=fly.stats.phototax&&dist(fly,this.lightPos())<0.3?0.7:1;
    const clockMetab=fly.stats.clock?(this.nightFactor>0.5?1.2:0.8):1;
    fly.energy-=fly.stats.metab*diapauseMetab*phototaxMetab*clockMetab*dt;

    // eat
    for(const item of this.food){
      if(dist(fly,item)<FOOD_RADIUS){
        const ft=FOOD_TYPES[item.type];
        const pheromoneGain=fly.pheromoneBoostT>0&&fly.pheromoneSite&&dist(item,fly.pheromoneSite)<0.18?1.5:1;
        fly.energy=Math.min(fly.stats.maxEnergy,fly.energy+ft.gain*fly.stats.foodMult*pheromoneGain);
        if(fly.stats.forager){ fly.foodBoostT=1; if(fly.isPlayer) this.floater(fly,"Forager: slowed for 1s",CSS.gold); }
        if(item.type==="rot"&&!fly.stats.noOdor){
          fly.odorT=ODOR_TIME;
          if(fly.isPlayer){ this.floater(fly,`Odor exposed for ${ODOR_TIME}s`,CSS.lavender); sfx.odor(); }
        }
        if(fly.isPlayer){
          const p=this.toPx(item.x,item.y);
          (item.type==="sugar"?this.emFood:item.type==="yeast"?this.emGold:this.emLav).explode(item.type==="sugar"?8:14,p.x,p.y);
          sfx.eat(item.type);
          if(item.type!=="sugar") this.floater(fly,"+"+Math.round(ft.gain*fly.stats.foodMult),item.type==="yeast"?CSS.gold:CSS.lavender);
        }
        this.relocateFood(item,fly);
      }
    }
    // lay egg
    if(fly.energy>=LAY_THRESHOLD&&fly.layCd<=0){
      fly.energy-=fly.stats.layCost; fly.eggs++; fly.layCd=LAY_CD;
      if(fly.stats.fecund){ fly.odorT=Math.max(fly.odorT,2); if(fly.isPlayer) this.floater(fly,"Fecund: odor exposed for 2s",CSS.lavender); }
      if(fly.stats.pheromone){
        const site={x:fly.x,y:fly.y,owner:fly.isPlayer?"player":"rival",t:3};
        fly.pheromoneSite=site;
        this.pheromoneSite=site;
        if(fly.isPlayer) this.uiLog(tr("Pheromone: the wild type will track your egg cluster.","信息素:野生型会追踪你的卵群。"));
        else if(this.playerFly.stats.pheromone){
          this.playerFly.pheromoneBoostT=3;
          this.playerFly.pheromoneSite={x:fly.x,y:fly.y};
          this.uiLog(tr("Pheromone: rival egg cluster found; nearby food gives +50% for 3s.","信息素:发现对手卵群;附近食物 3 秒内 +50%。"));
        }
        if(fly.isPlayer&&this.rivalFly.stats.pheromone){
          this.rivalFly.pheromoneBoostT=3;
          this.rivalFly.pheromoneSite={x:fly.x,y:fly.y};
        }
      }
      const p=this.toPx(fly.x,fly.y);
      const eggSpr=this.add.image(p.x,p.y,"egg").setDepth(7).setTint(fly.isPlayer?0xffffff:0xb49ae8);
      eggSpr.wx=fly.x; eggSpr.wy=fly.y; eggSpr.owner=fly.isPlayer?"player":"rival";
      this.eggsGroup.add(eggSpr);
      if(fly.isPlayer){
        sfx.egg(); this.emEgg.explode(12,p.x,p.y); this.floater(fly,"+1 egg",CSS.egg);
        this.uiLog(tr(`Egg laid! +1 offspring (egg ${fly.eggs})`,`产卵!+1 后代(第 ${fly.eggs} 枚)`));
      }
    }
    if(fly.energy<=0){
      fly.energy=0; fly.alive=false;
      if(fly.isPlayer){ fly.deathReason="energy"; sfx.death(); this.uiLog(tr("Energy depleted. This generation is over.","能量耗尽。这一代结束了。")); }
    }
  }

  predSpeedNow(){
    const scale=Math.min(1.8,1+0.05*(this.state.genNumber-1));
    return (PRED_BASE+PRED_BASE*0.5*this.nightFactor)*scale;
  }

  updatePredator(dt){
    const pr=this.predator;
    if(!pr.alive) return;
    const base=this.predSpeedNow();
    if(pr.phase==="approach"){
      let target=null,bd=Infinity,smelly=null;
      for(const f of this.flies){ if(f.alive&&f.odorT>0) smelly=f; }
      const guarded=this.playerFly.alive&&this.playerFly.stats.guard&&this.eggsGroup.getChildren().some(e=>e.owner==="player"&&dist(this.playerFly,e)<0.2);
      for(const f of this.flies){
        if(!f.alive) continue;
        if(guarded&&f.isPlayer) continue;
        const d=dist(pr,f);
        if(d<bd){bd=d;target=f;}
      }
      if(smelly&&(!guarded||smelly!==this.playerFly)) target=smelly;
      if(!target&&!guarded&&this.playerFly.alive) target=this.playerFly;
      if(!target) return;
      pr.target=target;
      if(target.odorT>0) bd=dist(pr,target);
      const spdA=base*(target.odorT>0?1.15:1)*(target===this.rivalFly&&this.playerFly.stats.guard?1.05:1);
      const dir=normalize({x:target.x-pr.x,y:target.y-pr.y});
      pr.vx+=(dir.x*spdA-pr.vx)*Math.min(1,dt*6); pr.vy+=(dir.y*spdA-pr.vy)*Math.min(1,dt*6);
      pr.x+=pr.vx*dt; pr.y+=pr.vy*dt;
      if(bd<PRED_LUNGE_RANGE){
        const ld=Math.hypot(target.x-pr.x,target.y-pr.y)||1;
        pr.lungeDir={x:(target.x-pr.x)/ld,y:(target.y-pr.y)/ld};
        pr.phase="lunge"; pr.lungeT=0;
        // JUICE: the commit moment — slow-mo + roar + zoom shake
        sfx.lunge(); this.cameras.main.shake(140,0.006); this.slowmoT=0.30;
        if(!this.__bench&&pr.target===this.playerFly)
          document.dispatchEvent(new CustomEvent("flyline:lunge"));
      }
    } else if(pr.phase==="lunge"){
      pr.lungeT+=dt;
      const lspd=base*(PRED_LUNGE/PRED_BASE);
      pr.vx=pr.lungeDir.x*lspd; pr.vy=pr.lungeDir.y*lspd;
      pr.x+=pr.vx*dt; pr.y+=pr.vy*dt;
      const r=Math.hypot(pr.x,pr.y);
      if(pr.lungeT>0.45||r>0.95){ pr.phase="recover"; pr.recoverT=0; }
    } else {
      pr.recoverT+=dt;
      pr.vx*=0.85; pr.vy*=0.85;
      pr.x+=pr.vx*dt; pr.y+=pr.vy*dt;
      if(pr.recoverT>0.5) pr.phase="approach";
    }
    const rr=Math.hypot(pr.x,pr.y);
    if(rr>0.98){ pr.x=pr.x/rr*0.98; pr.y=pr.y/rr*0.98; }
    pr.angle=Math.atan2(pr.vy,pr.vx); pr.legPhase+=dt*14;

    for(const f of this.flies){
      if(f.stats.cannibal&&f.isPlayer&&this.rivalFly.alive&&dist(f,this.rivalFly)<0.14){
        f.energy=Math.min(f.stats.maxEnergy,f.energy+2*dt);
        this.rivalFly.energy=Math.max(0,this.rivalFly.energy-2*dt);
        this.rivalFly.cannibalSlowT=0.3;
        if(!f.stats.noOdor) f.odorT=Math.max(f.odorT,1.2);
      }
      for(const egg of this.eggsGroup.getChildren()){
        if(this.playerFly.stats.guard&&egg.owner==="player"&&dist(pr,{x:egg.wx,y:egg.wy})<PRED_CATCH*1.5){
          egg.destroy();
          this.playerFly.eggs=Math.max(0,this.playerFly.eggs-1);
          break;
        }
      }
      if(f.alive&&f.gf.iframe<=0&&dist(pr,f)<PRED_CATCH){
        if(f.stats.tiger&&f.kbCdT<=0){
          f.kbCdT=8;
          const ka=normalize({x:pr.x-f.x,y:pr.y-f.y});
          pr.vx+=ka.x*1.6; pr.vy+=ka.y*1.6; pr.phase="recover"; pr.recoverT=-0.7; f.gf.iframe=0.25;
          if(f.isPlayer){
            sfx.tiger(); this.floater(f,tr("Tiger counterattack!","虎纹反击!"),CSS.gold); this.cameras.main.shake(180,0.01);
            const p=this.toPx(pr.x,pr.y); this.emGold.explode(18,p.x,p.y);
            this.uiLog(tr("Tiger counterattack: the predator was knocked back and stunned!","虎纹反击:捕食者被击退并震慑!"));
          }
          continue;
        }
        f.energy-=PRED_DPS*f.stats.predDmg*dt;
        if(f.isPlayer){
          this.dangerFlash=1; this.cameras.main.shake(90,0.004);
          if(!f._warned){ sfx.bite(); this.uiLog(this.isTouch
            ?tr("⚠ Committed strike connected! Tap GF when the button lights up to jump clear.","⚠ 扑击命中!GF 按钮亮起时点它起跳脱身。")
            :tr("⚠ Committed strike connected! Press Space when the GF reflex lights up to dodge the ballistic strike.","⚠ 扑击命中!GF 反射亮起时按空格,躲开这次弹道扑杀。")); f._warned=true; }
        }
        if(f.energy<=0){ f.energy=0; f.alive=false; if(f.isPlayer){ f.deathReason="predator"; sfx.death(); this.uiLog(tr("The predator killed you.","你被捕食者杀死了。")); } }
      } else if(f.isPlayer) f._warned=false;
    }
    if(this.playerFly.alive){
      const pd=dist(pr,this.playerFly);
      if(pd<0.35) this.dangerFlash=Math.max(this.dangerFlash,(0.35-pd)/0.35*0.8);
    }
  }

  // ============================== generation flow ==============================
  drawCards(){
    // deterministic: the draft depends only on (worldSeed, gen, eggs, rivalEggs, owned)
    return draftCards(this.state.worldSeed, this.state.genNumber,
      this.playerFly.eggs, this.rivalFly.eggs, this.state.ownedTraits);
  }
  endGeneration(){
    if(this.ended) return;
    this.ended=true; this.running=false;
    const eggs=this.playerFly.eggs, rivalEggs=this.rivalFly.eggs;
    const deathReason=this.playerFly.alive?"time":(this.playerFly.deathReason||"predator");
    this.uiLog(this.playerFly.alive?tr("⏱ You survived the full 50 seconds.","⏱ 你熬过了完整 50 秒。"):tr("🧬 This generation ended, but your lineage continues.","🧬 这一代结束了,但你的血脉还在继续。"));
    this.state.eggsHistory.push(eggs); if(this.state.eggsHistory.length>30) this.state.eggsHistory.shift();
    this.state.lineageEggs+=eggs;
    const isBest=eggs>this.state.bestEggs; if(isBest) this.state.bestEggs=eggs;
    const win=eggs>=rivalEggs;
    sfx.genEnd(win);
    this.saveState();
    const genendDetail={
      gen:this.state.genNumber, eggs, rivalEggs, win, isBest, deathReason,
      alive:this.playerFly.alive, lineageEggs:this.state.lineageEggs,
      bestEggs:this.state.bestEggs, cards:this.drawCards(),
      escapes:this.escapesThisGen||0,
      brain:{ id:this.playerBrainId, model:this.brainDriver?this.brainDriver.model:"player",
        decisions:this.brainLog.length,
        avgConfidence:this.brainLog.length
          ?this.brainLog.reduce((a,r)=>a+r.confidence,0)/this.brainLog.length
          :null } };
    document.dispatchEvent(new CustomEvent("flyline:genend",{detail:genendDetail}));
    this.recordDishQuests(genendDetail);
  }

  // v1 freemint quests: record the first completion of each dish quest as a
  // client-attested evidence object (validated server-side by app/lib/dish.ts).
  // The Passport is soul-bound and free, so the prize for forging one is a
  // badge you cannot sell; v2 re-simulates the run server-side.
  recordDishQuests(detail){
    if(this.__bench) return; // exam-room runs earn EXAMINED, not the dish quests
    try{
      const store=JSON.parse(localStorage.getItem("flyline_quests_v1")||"{}");
      const base={ gen:detail.gen, eggs:detail.eggs, rivalEggs:detail.rivalEggs,
        survived:detail.alive, deathReason:detail.deathReason, escapes:detail.escapes,
        brain:detail.brain, decisions:detail.brain.decisions||0, ts:Date.now() };
      const hit=(quest)=>{
        if(store[quest]) return;
        store[quest]={quest,...base};
        this.uiLog(tr(`🏅 DISH quest complete: ${quest} — claim your free mint on the Passport page.`,`🏅 任务完成:${quest} —— 到首页护照区领取免费铸造。`));
        document.dispatchEvent(new CustomEvent("flyline:quest",{detail:{quest}}));
      };
      if(detail.alive) hit("SURVIVOR");
      if(detail.eggs>=3) hit("FORAGER");
      if(detail.escapes>=3) hit("REFLEX");
      localStorage.setItem("flyline_quests_v1",JSON.stringify(store));
    }catch(e){ console.warn("[ffw] quest record failed:",e); /* private mode: the generation still ends normally */ }
  }
  // Quest bridge for agent runs: a headless autopilot run records its quest
  // evidence in the browser it ran in. The agent hands the JSON to the
  // operator, who opens one URL (or calls this via FlyLabAPI) to take the
  // evidence into their own browser. Entries are merged verbatim — the server
  // re-validates every field at claim time (verifyDishEvidence), so this is
  // the same client-attested trust level as playing by hand (v1).
  importQuests(store){
    const cur=(()=>{ try{ return JSON.parse(localStorage.getItem("flyline_quests_v1")||"{}"); }catch(e){ return {}; } })();
    if(!store||typeof store!=="object") return {imported:0,total:Object.keys(cur).length};
    let n=0;
    for(const k of ["SURVIVOR","FORAGER","REFLEX","EXAMINED"]){
      const e=store[k];
      if(!e||typeof e!=="object"||e.quest!==k||cur[k]) continue;
      cur[k]=e; n++;
      this.uiLog(tr(`🏅 DISH quest complete: ${k} — claim your free mint on the Passport page.`,`🏅 任务完成:${k} —— 到首页护照区领取免费铸造。`));
      document.dispatchEvent(new CustomEvent("flyline:quest",{detail:{quest:k}}));
    }
    if(n>0){ try{ localStorage.setItem("flyline_quests_v1",JSON.stringify(cur)); }catch(err){} }
    return {imported:n,total:Object.keys(cur).length};
  }
  // ---- agent autopilot: fly the dish end to end without a human ----
  // Deterministic brains run one fixed-60Hz run (same discipline as the exam
  // room), single-run and quest-recording: at every generation boundary the
  // policy is asked one draft question — which mutation does the next fly
  // inherit? — and the sealed log plus DISH quest evidence land in localStorage
  // exactly as a human run would.
  //
  // Oracle mode (opts.oracle / opts.key) is the other lane: a REMOTE judgment
  // model drives the behavior decisions live, once per second, through the
  // same-origin /api/jev proxy. The loop paces to real time so the oracle can
  // answer inside it. Receipt honesty: an API oracle cannot be re-run, so the
  // result is sealed-but-not-replayable — oracle runs must never be presented
  // as IDENTICAL or replayable. That lane is what "the model flies the fly"
  // actually means.
  async autopilot(opts={}){
    const seed=(opts.seed||this.state.worldSeed||42)>>>0;
    const brain=["circuit","judgment","genes","manual"].includes(opts.brain)?opts.brain:"circuit";
    const gens=Math.max(1,Math.min(8,opts.gens||3));
    const policy=typeof opts.policy==="function"?opts.policy:null;
    if(opts.key!==undefined&&opts.key!==null&&String(opts.key).trim())
      localStorage.setItem("flyline_jev_key",String(opts.key).trim());
    const oracleWanted=(opts.oracle===true)||(opts.key!==undefined&&opts.key!==null&&String(opts.key).trim()!=="");
    if(oracleWanted&&brain!=="judgment")
      throw new Error("oracle mode requires --brain judgment (a remote System One model drives the fly)");
    if(oracleWanted&&!localStorage.getItem("flyline_jev_key"))
      throw new Error("oracle mode needs a System One key (--key, or localStorage flyline_jev_key)");
    // deterministic default policy: economy first (survive → convert → endure),
    // then whatever the dish offers. A real agent replaces this with judgment.
    const PREF=["forager","fecund","hardy","thrift","nocturnal","white","curly","swift"];
    const savedState=JSON.parse(JSON.stringify(this.state));
    const wasBench=this.__bench;
    const quests0=(()=>{ try{ return JSON.parse(localStorage.getItem("flyline_quests_v1")||"{}"); }catch(e){ return {}; } })();
    this.__bench=true; // suppress draft UI, coach, replay — same as the exam room
    try{ this.scene.pause(); }catch(e){ /* loop already stopped */ }
    const DT=1000/60;
    const out=[];
    // oracle = remote model driving. Checked live, not latched: if the remote
    // brain fails mid-run the driver swaps to the local heuristic and pacing
    // (and the final oracle label) must follow the truth, not the start state.
    const oracleNow=()=>!!this.brainDriver&&!this.brainDriver.model.startsWith("local-heuristic");
    try{
      this.state=JSON.parse(JSON.stringify(savedState));
      this.state.worldSeed=seed; this.state.brainId=brain; this.state.genNumber=1;
      this.state.ownedTraits=[]; this.state.lineageEggs=0; this.state.bestEggs=0; this.state.eggsHistory=[];
      this.rivalFly.rivalTraits=[];
      this.playerBrainId=brain; this.attachBrain(brain,{silent:true});
      this.started=true;
      this.visitedCells=new Set(); this.simTime=0; this.slowmoT=0; this.dangerFlash=0;
      this.savedRivalSnapshot=null;
      this.predator.target=null; this.predator.angle=0;
      this.predator.lungeDir={x:0,y:0}; this.predator.legPhase=0;
      this.agentVec=null; this.touchVec=null;
      this.playerFly.gf=makeGFState(); this.rivalFly.gf=makeGFState();
      this.escapesThisGen=0;
      this.resetGenerationWorld();
      for(let g=1;g<=gens;g++){
        let frames=0;
        while(!this.ended&&frames<GEN_DURATION*60+240){
          // oracle runs pace to wall time: the remote decision has to land
          // inside the loop, and the driver's staleness window is sim time —
          // at unthrottled speed every oracle answer would arrive "stale".
          if(oracleNow()) await new Promise(r=>setTimeout(r,DT));
          else await Promise.resolve();
          this.update(frames*DT,DT); frames++;
        }
        const log=this.brainLog.slice();
        const detail={ gen:g, eggs:this.playerFly.eggs, rivalEggs:this.rivalFly.eggs,
          win:this.playerFly.eggs>=this.rivalFly.eggs,
          alive:this.playerFly.alive,
          deathReason:this.playerFly.alive?"time":(this.playerFly.deathReason||"predator"),
          escapes:this.escapesThisGen||0, decisions:log.length,
          brain:{ id:this.playerBrainId, model:this.brainDriver?this.brainDriver.model:"player",
            decisions:log.length,
            avgConfidence:log.length?log.reduce((a,r)=>a+r.confidence,0)/log.length:null } };
        out.push({ gen:g, eggs:detail.eggs, rivalEggs:detail.rivalEggs,
          survived:detail.alive, deathReason:detail.deathReason,
          decisions:log.length, logHash:contentHash(log.map(r=>r.contentHash)),
          brainModel:detail.brain.model,
          log }); // full per-gen records: the deliverable is the whole chain, not the last generation
        // quests record exactly as a human run (recordDishQuests skips __bench)
        const b=this.__bench; this.__bench=false; this.recordDishQuests(detail); this.__bench=b;
        if(g<gens){
          const cards=draftCards(seed,this.state.genNumber,
            this.playerFly.eggs,this.rivalFly.eggs,this.state.ownedTraits);
          const q={ cards, state:{ gen:this.state.genNumber, eggs:this.playerFly.eggs,
            rivalEggs:this.rivalFly.eggs, ownedTraits:this.state.ownedTraits.slice(),
            lineageEggs:this.state.lineageEggs } };
          document.dispatchEvent(new CustomEvent("flyline:draft",{detail:JSON.parse(JSON.stringify(q))}));
          let pick=policy?policy(q.cards,q.state):null;
          if(!cards.includes(pick)) pick=PREF.find(t=>cards.includes(t))||cards[0];
          this.nextGen(pick);
        }
      }
    } finally {
      this.__bench=wasBench;
      this.state=savedState;
    }
    // full evidence objects for the quests THIS run completed (headless agents
    // hand them to the operator, who imports them with one URL — see importQuests)
    let questsAll={}; try{ questsAll=JSON.parse(localStorage.getItem("flyline_quests_v1")||"{}"); }catch(e){}
    const quests={}; for(const k in questsAll) if(!(k in quests0)) quests[k]=questsAll[k];
    // label from what actually drove the fly, per generation — a run that fell
    // back to the local heuristic partway is NOT an oracle run end to end
    const oracleGens=out.filter(g=>!String(g.brainModel||"").startsWith("local-heuristic"));
    const oracleLived=oracleGens.length>0;
    const oracleModel=oracleLived?oracleGens[0].brainModel:null;
    return { version:"flyline-autopilot/1", seed, brain, gens,
      eggsTotal:out.reduce((a,g)=>a+g.eggs,0),
      decisions:out.reduce((a,g)=>a+g.decisions,0),
      policy:policy?"custom":"default-economy", gens:out,
      oracle: oracleLived ? { live:true, model:oracleModel,
        degraded:oracleGens.length<out.length
          ?"the remote model failed mid-run and later generations ran the local heuristic":null,
        note:"sealed, not replayable — an API model drove the fly; do not claim IDENTICAL" } :
        { live:false },
      replayable: !oracleLived,
      quests, log:window.FlyLabAPI.getDecisionLog() };
  }
  nextGen(traitId){
    this.state.ownedTraits.push(traitId);    this.uiLog(tr(`🧬 Generation ${this.state.genNumber+1} inherits mutation: ${traitId}`,`🧬 第 ${this.state.genNumber+1} 代继承突变:${TRAIT_INFO[traitId]?TRAIT_INFO[traitId].name.split(" ")[0]:traitId}`));
    this.state.genNumber+=1;
    this.resetGenerationWorld();
  }

  // ============================== per-frame ==============================
  update(time,delta){
    const dtReal=Math.min(delta/1000,0.1);
    // slow-mo window right after a lunge commit
    if(this.slowmoT>0) this.slowmoT-=dtReal;
    const dtScale=this.slowmoT>0?0.35:1;

    if(this.running&&!this.ended&&this.started){
      const dt=dtReal*dtScale;
      this.simTime+=dt; this.genElapsed+=dt;
      this.nightFactor=(1-Math.cos(2*Math.PI*this.genElapsed/CYCLE_SEC))/2;
      this.updateFly(this.playerFly,dt);
      this.updateFly(this.rivalFly,dt);
      this.updatePredator(dt);
      if(!this.__bench){
        this.replayBuf.push({
          p:{x:this.playerFly.x,y:this.playerFly.y,a:this.playerFly.angle},
          r:{x:this.rivalFly.x,y:this.rivalFly.y,a:this.rivalFly.angle,alive:this.rivalFly.alive},
          e:{x:this.predator.x,y:this.predator.y,a:this.predator.angle,lunge:this.predator.phase==="lunge"}});
        if(this.replayBuf.length>360) this.replayBuf.shift();
      }
      this.updateBrain(dt);
      this.genTimeLeft-=dt;
      if(!this.playerFly.alive||this.genTimeLeft<=0) this.endGeneration();
    }
    this.dangerFlash=Math.max(0,this.dangerFlash-dtReal*2.2);
    this.renderWorld(dtReal);
    this.updateHud();
  }

  renderWorld(dtReal){
    if(this.replaying){ this.stepReplay(dtReal); return; }
    // GF-ready sound edge
    if(this.playerFly.gf.armed&&!this.gfWasArmed) sfx.gfReady();
    this.gfWasArmed=this.playerFly.gf.armed;

    // flies
    for(const f of this.flies){
      const v=this.flyView[f.isPlayer?"p":"r"];
      const p=this.toPx(f.x,f.y);
      v.cont.setVisible(f.alive);
      if(!f.alive) continue;
      v.cont.setPosition(p.x,p.y);
      v.cont.setRotation(f.angle+Math.PI/2);
      // wing flap: faster when moving / dashing
      const spd01=clamp01(Math.hypot(f.vx,f.vy)/0.6);
      const flap=Math.sin(this.simTime*(30+70*spd01))*0.9;
      v.wingL.setRotation(flap); v.wingR.setRotation(-flap);
      v.body.setAlpha(f.gf.iframe>0?0.45:1);
      // stink lines when smelly
      const key=f.isPlayer?"p":"r";
      if(f.odorT>0){
        if(!this.stinkP[key]){
          const s=this.add.sprite(p.x,p.y,"stink").setDepth(13);
          this.tweens.add({targets:s,alpha:{from:.8,to:.2},duration:600,yoyo:true,repeat:-1});
          this.stinkP[key]=s;
        }
        this.stinkP[key].setPosition(p.x,p.y).setVisible(true);
      } else if(this.stinkP[key]){ this.stinkP[key].setVisible(false); }
    }
    // trails
    const tg=this.trailG; tg.clear();
    for(const f of this.flies){
      if(!f.alive||f.trail.length<2) continue;
      tg.lineStyle(f.isPlayer?3:2,f.isPlayer?COL.egg:COL.lavender,f.isPlayer?0.22:0.14);
      tg.beginPath();
      f.trail.forEach((t,i)=>{ const p=this.toPx(t.x,t.y); i?tg.lineTo(p.x,p.y):tg.moveTo(p.x,p.y); });
      tg.strokePath();
    }
    // spider + legs
    const pr=this.predator;
    if(pr.alive){
      const sp=this.toPx(pr.x,pr.y);
      this.spiderCont.setVisible(true).setPosition(sp.x,sp.y).setRotation(pr.angle);
      this.spiderLegs.clear();
      this.spiderLegs.lineStyle(2.5,0xc83c50,0.85);
      for(let i=0;i<4;i++){
        const a=0.5+i*0.4, off=Math.sin(pr.legPhase+i)*5;
        this.spiderLegs.lineBetween(0,0,Math.cos(a)*42,Math.sin(a)*42+off);
        this.spiderLegs.lineBetween(0,0,Math.cos(-a)*42,Math.sin(-a)*42-off);
      }
      const lunging=pr.phase==="lunge";
      const sc=lunging?1.15:1;
      this.spiderBody.setScale(0.9*sc);
      this.spiderCont.setDepth(lunging?13:11);
    } else this.spiderCont.setVisible(false);
    // night overlay + light
    this.nightOverlay.setFillStyle(0x0a1030,this.nightFactor*0.38);
    const lp=this.lightPos(), lpp=this.toPx(lp.x,lp.y);
    this.lightGlow.setPosition(lpp.x,lpp.y).setAlpha(0.16*(1-0.7*this.nightFactor));
    // danger vignette (DOM)
    if(window.__vignette) window.__vignette.style.opacity=this.dangerFlash.toFixed(2);
  }

  updateHud(){
    const q=id=>document.getElementById(id);
    const f=this.playerFly;
    if(!q("hGen")) return;
    q("hGen").textContent=this.state.genNumber;
    q("hTime").textContent=Math.max(0,this.genTimeLeft).toFixed(1);
    q("hEggs").textContent=f.eggs;
    q("hLineage").textContent=this.state.lineageEggs+f.eggs;
    q("hBest").textContent=this.state.bestEggs;
    q("hCycle").textContent=this.nightFactor>0.5?"🌙 Night":"☀ Day";
    q("hEnergyBar").style.width=Math.max(0,f.energy/f.stats.maxEnergy*100)+"%";
    q("hEnergyTxt").textContent=Math.round(f.energy);
    const gb=q("hGfBar"); gb.style.width=Math.max(0,Math.min(100,f.gf.pot*100))+"%";
    q("hGfWrap").classList.toggle("armed",f.gf.armed);
    q("hLc4Bar").style.width=Math.round(Math.max(0,Math.min(1,f.gf.lc4))*100)+"%";
    q("hLplc2Bar").style.width=Math.round(Math.max(0,Math.min(1,f.gf.lplc2))*100)+"%";
    q("hGfState").textContent=f.gf.armed?"● GF READY":(f.dashCdT>0?"Charging":"Standby");
    const gb2=document.getElementById("gfBtn");
    if(gb2) gb2.classList.toggle("armed",f.gf.armed);
    const ye=f.eggs, re=this.rivalFly.eggs, tot=Math.max(1,ye+re);
    q("hRvYou").textContent=ye; q("hRvRival").textContent=re;
    q("hRvYouBar").style.width=(ye/tot*100)+"%";
    q("hRvRivalBar").style.width=(re/tot*100)+"%";
  }

  floater(fly,text,color){
    const p=this.toPx(fly.x,fly.y);
    const t=this.add.text(p.x,p.y-26,text,{fontFamily:"Menlo,monospace",fontSize:"13px",color,fontStyle:"bold"}).setOrigin(0.5).setDepth(20);
    this.tweens.add({targets:t,y:p.y-56,alpha:0,duration:850,ease:"Quad.out",onComplete:()=>t.destroy()});
  }
  uiLog(msg){
    document.dispatchEvent(new CustomEvent("flyline:log",{detail:msg}));
  }

  // ---- UI hooks ----
  beginRun(){
    this.started=true; this.running=true; sfx.resume();
    if(this.state.genNumber===1&&this.state.ownedTraits.length===0) this.uiLog(tr("Eat sugar to restore energy. When the predator commits, wait for GF READY, then jump.","吃糖恢复能量。捕食者锁定时,等 GF「就绪」亮起,再起跳。"));
  }
  setPaused(p){ if(this.started&&!this.ended) this.running=!p; }
  setConnectivity(mode){ this.state.connectivityMode=mode; this.saveState(); }
  setSeed(v){ this.state.worldSeed=v>>>0; this.saveState(); this.resetGenerationWorld(); }
}
function rngUse(){ return Math.random(); }
