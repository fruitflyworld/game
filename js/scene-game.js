// scene-game.js — the playable world. All sim logic ported from the validated prototype;
// rendering/juice rewritten on Phaser 3.
import {
  GEN_DURATION, CYCLE_SEC, FOOD_RADIUS, FOOD_SENSE, THREAT_SENSE, NOVELTY_SENSE, GRID_N, FOOD_COUNT,
  LAY_THRESHOLD, LAY_COST, LAY_CD, DASH_SPEED, DASH_TIME, DASH_CD, DASH_COST,
  PRED_BASE, PRED_LUNGE, PRED_LUNGE_RANGE, PRED_CATCH, PRED_DPS,
  GF, PRED_VISUAL, FOOD_TYPES, ODOR_TIME, TRAIT_INFO, NAMED_ONCE, STACKABLE, draftCards,
  clamp01, dist, normalize, rng, seedRng, randRange, randomInDish,
  recomputeStats, makeFly, resetFly,
  GF_PARAMS, stepGF, fireGF
} from "./sim.js";
import { createCircuitBrain } from "./brain-circuit.js";
import { createLocalBrain } from "./brain-local.js";
import { createJevBrain, JEV_MODEL_DEFAULT } from "./brain-jev.js";
import { createBrainDriver } from "./brain-driver.js";
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
    this.rivalFly=makeFly(false, {food:randRangeUse(.4,.9),threat:randRangeUse(.4,.9),light:randRangeUse(0,.5),novelty:randRangeUse(.1,.6),forage:randRangeUse(.3,.8)});
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
      downloadDecisionLog:()=>this.downloadDecisionLog()
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
      this.uiLog(id==="manual"?"Brain: MANUAL — you drive (WASD + Space)."
        :id==="genes"?"Brain: GENES — gene-weighted auto-pilot."
        :id==="circuit"?"Brain: CIRCUIT — FFW-CX/0.1, 24 spiking neurons."
        :(this.brainDriver&&this.brainDriver.model!==("local-heuristic/0.1")
          ?"Brain: JUDGMENT — "+this.brainDriver.model+" via /api/jev."
          :"Brain: JUDGMENT — local-heuristic/0.1 (no key set; free offline)."));
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
      this.uiLog("Judgment model unreachable — fell back to local-heuristic/0.1. Check your key or the /api/jev proxy.");
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
    this.uiLog("Brain error — steering falls back to genes until it recovers.");
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
    // rival arms race: restores saved build, drafts ONE mutation per gen (deterministic)
    if(this.savedRivalSnapshot){ this.rivalFly.rivalTraits=this.savedRivalSnapshot.slice(); this.savedRivalSnapshot=null; }
    const poolR=NAMED_ONCE.concat(STACKABLE).filter(t=>STACKABLE.includes(t)||!this.rivalFly.rivalTraits.includes(t));
    if(poolR.length&&gen>1){
      const pick=poolR[Math.floor(rng()*poolR.length)];
      this.rivalFly.rivalTraits.push(pick);
      this.uiLog(`🧬 Wild type evolved: ${pick}`);
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
    if(hopper&&fly.isPlayer) this.uiLog("Hopper: active escape costs more energy.");
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
    if(fly.isPlayer&&inDiapause&&!fly._diapauseNotified){ this.floater(fly,"Diapause: energy saving",CSS.violet||CSS.lavender); this.uiLog("Diapause active: lower metabolism, slower movement."); fly._diapauseNotified=true; }
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
        if(fly.isPlayer) this.uiLog("Pheromone: the wild type will track your egg cluster.");
        else if(this.playerFly.stats.pheromone){
          this.playerFly.pheromoneBoostT=3;
          this.playerFly.pheromoneSite={x:fly.x,y:fly.y};
          this.uiLog("Pheromone: rival egg cluster found; nearby food gives +50% for 3s.");
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
        this.uiLog(`Egg laid! +1 offspring (egg ${fly.eggs})`);
      }
    }
    if(fly.energy<=0){
      fly.energy=0; fly.alive=false;
      if(fly.isPlayer){ fly.deathReason="energy"; sfx.death(); this.uiLog("Energy depleted. This generation is over."); }
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
            sfx.tiger(); this.floater(f,"Tiger counterattack!",CSS.gold); this.cameras.main.shake(180,0.01);
            const p=this.toPx(pr.x,pr.y); this.emGold.explode(18,p.x,p.y);
            this.uiLog("Tiger counterattack: the predator was knocked back and stunned!");
          }
          continue;
        }
        f.energy-=PRED_DPS*f.stats.predDmg*dt;
        if(f.isPlayer){
          this.dangerFlash=1; this.cameras.main.shake(90,0.004);
          if(!f._warned){ sfx.bite(); this.uiLog(this.isTouch
            ?"⚠ Committed strike connected! Tap GF when the button lights up to jump clear."
            :"⚠ Committed strike connected! Press Space when the GF reflex lights up to dodge the ballistic strike."); f._warned=true; }
        }
        if(f.energy<=0){ f.energy=0; f.alive=false; if(f.isPlayer){ f.deathReason="predator"; sfx.death(); this.uiLog("The predator killed you."); } }
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
    this.uiLog(this.playerFly.alive?"⏱ You survived the full 50 seconds.":"🧬 This generation ended, but your lineage continues.");
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
        this.uiLog(`🏅 DISH quest complete: ${quest} — claim your free mint on the Passport page.`);
      };
      if(detail.alive) hit("SURVIVOR");
      if(detail.eggs>=3) hit("FORAGER");
      if(detail.escapes>=3) hit("REFLEX");
      localStorage.setItem("flyline_quests_v1",JSON.stringify(store));
    }catch(e){ /* private mode: the generation still ends normally */ }
  }
  nextGen(traitId){
    this.state.ownedTraits.push(traitId);
    this.uiLog(`🧬 Generation ${this.state.genNumber+1} inherits mutation: ${traitId}`);
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
    if(this.state.genNumber===1&&this.state.ownedTraits.length===0) this.uiLog("Eat sugar to restore energy. When the predator commits, wait for GF READY, then jump.");
  }
  setPaused(p){ if(this.started&&!this.ended) this.running=!p; }
  setConnectivity(mode){ this.state.connectivityMode=mode; this.saveState(); }
  setSeed(v){ this.state.worldSeed=v>>>0; this.saveState(); this.resetGenerationWorld(); }
}
function randRangeUse(a,b){ return randRange(a,b); }
function rngUse(){ return Math.random(); }
