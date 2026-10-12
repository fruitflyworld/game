// ui.js — DOM overlay logic: menu, draft cards, HUD extras, touch joystick. Bridges DOM ↔ GameScene.
import { TRAIT_INFO, runExperiment, GEN_DURATION } from "./sim.js";
import { sfx } from "./audio.js";

const $=id=>document.getElementById(id);
let gameScene=null;
// tr: one-line localizer for scene-layer messages. The scene imports this so
// every user-facing log line follows the language selector.
export function tr(en){ return en; }
const language="en"; // English-only build; the strings below are the source of truth
const LANG={
  en:{label:"Language",start:"Start first generation →",continue:g=>`Continue generation ${g} →`,reset:"Clear lineage save",pause:"Pause / menu",subtitle:"Fruit-fly lineage · biological survival game",intro:"You are a lineage, not a single fly. Gather food and energy → lay eggs automatically; the predator commits to a ballistic strike. When the GF reflex lights up READY, press Space to jump.",phone:"Mobile: hold and drag anywhere to steer; tap GF when it lights up.",food:"Food: sugar +12 (safe) · yeast +26 (rim, predator risk) · rot +38 (odor exposure).",circuit:"Escape circuit · connectome-inspired",real:"Real connectivity",shuffled:"Swapped connectivity",seed:"Set seed",experiment:"Run wiring check · real vs swapped",draftPrompt:"What will this generation leave behind? Choose one mutation for the next generation.",touchHint:"Hold and drag anywhere to steer",brainTitle:"Choose your fly's brain",brainNote:"Same world, same rules. The brain only decides where to go — the GF brainstem still owns the escape jump.",brainManual:"You drive · WASD",brainGenes:"auto-pilot baseline",brainCircuit:"FFW-CX/0.1 · 24 neurons",brainJudgment:"local heuristic · free",brainJudgmentKey:"System One · jev-1.13.0",brainKeyLabel:"System One key",brainKeyNote:"jev-1.13.0 via same-origin /api/jev proxy · key stored in this browser only · on failure the local heuristic takes over",brainDl:"⤓ log",brainLine:`Brain this generation`,coach1:"<b>MOVE & EAT</b> — steer toward the green sugar. Energy above the line becomes eggs automatically.",coach2:"<b>ESCAPE</b> — the predator just committed. Wait for <b>GF READY</b>, then press SPACE (or tap the GF button) to jump clear.",coach3:"<b>DRAFT</b> — pick ONE mutation: it is the body your next fly is born with. The wild type evolves too.",coachGot:"GOT IT — tap to dismiss",replay:"◉ DEATH REPLAY ×0.5",deathCopy:"COPY DEATH AS CHALLENGE",deathCopied:"COPIED ✓ — PASTE IT ANYWHERE",esc:`The predator is now faster and safe food is scarcer.`},
};
function lang(){return LANG[language]||LANG.en;}
function applyLanguage(){
  const l=lang(); document.documentElement.lang=language;
  $("mReset").textContent=l.reset; $("hPause").title=l.pause;
  document.querySelector("#menu .subtitle").textContent=l.subtitle;
  const p=document.querySelectorAll("#menu .howto");
  p[0].textContent=l.intro; p[1].textContent=l.phone; p[2].textContent=l.food;
  document.querySelector(".circCard h3").textContent=l.circuit;
  document.querySelector('[data-conn="real"]').textContent=l.real;
  document.querySelector('[data-conn="shuffled"]').textContent=l.shuffled;
  document.querySelector(".brainCard h3").textContent=l.brainTitle||LANG.en.brainTitle;
  document.querySelector(".brainCard .tiny").textContent=l.brainNote||LANG.en.brainNote;
  const bs={manual:l.brainManual||LANG.en.brainManual,genes:l.brainGenes||LANG.en.brainGenes,
    circuit:l.brainCircuit||LANG.en.brainCircuit,judgment:l.brainJudgment||LANG.en.brainJudgment};
  document.querySelectorAll(".brainBtn").forEach(b=>{
    const s=b.querySelector("s"); if(s) s.textContent=bs[b.dataset.brain]||"";
  });
  $("seedApply").textContent=l.seed; $("expBtn").textContent=l.experiment;
  const bc=document.querySelector(".brainCfg");
  if(bc){
    bc.querySelector("label").textContent=l.brainKeyLabel||LANG.en.brainKeyLabel;
    bc.querySelector(".tiny").textContent=l.brainKeyNote||LANG.en.brainKeyNote;
    const sub=$("judgmentSub");
    if(sub) sub.textContent=localStorage.getItem("flyline_jev_key")
      ?(l.brainJudgmentKey||LANG.en.brainJudgmentKey)
      :(l.brainJudgment||LANG.en.brainJudgment);
  }
  const dl=$("hBrainDl"); if(dl) dl.textContent=l.brainDl||LANG.en.brainDl;
  $("dsubtitle").textContent=l.draftPrompt||LANG.en.draftPrompt;
  refreshMenuStats();
  if($("touchHint")) $("touchHint").textContent=l.touchHint||LANG.en.touchHint;
}
function trLog(msg){
  return msg;
}


export function initUI(scene){
  gameScene=scene;
  makeVignette();
  wireMenu();
  wireHud();
  wireTouch();
  document.addEventListener("flyline:log",e=>addLog(e.detail));
  // quest completion gets a real banner, not just a log line: the freemint is
  // the player's receipt, and it must be impossible to play past it
  document.addEventListener("flyline:quest",e=>{
    const old=document.getElementById("questToast"); if(old) old.remove();
    const q=e.detail.quest;
    const el=document.createElement("div");
    el.id="questToast";
    const title="DISH QUEST COMPLETE";
    const body=`<b>${q}</b> recorded — this unlocks the free Passport mint.`;
    el.innerHTML=`<div class="qTitle">🏅 ${title}</div><div class="qBody">${body}</div>`+
      `<a class="qLink" href="/#mint">CLAIM FREE MINT →</a>`;
    document.body.appendChild(el);
    const kill=()=>el.remove();
    el.addEventListener("click",e=>{ if(e.target.tagName!=="A") kill(); });
    setTimeout(kill,12000);
  });
  document.addEventListener("flyline:genend",e=>showDraft(e.detail));
  document.addEventListener("flyline:genstart",e=>onGenStart(e.detail));
  // step-2 coach: the first committed lunge at the player (manual brain only)
  document.addEventListener("flyline:lunge",()=>{
    if(gameScene.__bench||gameScene.playerBrainId!=="manual") return;
    coach("flyline_ob2",lang().coach2||LANG.en.coach2);
  });
  // death-replay banner
  const rt=document.createElement("div");
  rt.id="replayTag"; rt.style.display="none";
  $("hud").appendChild(rt);
  document.addEventListener("flyline:replay",()=>{ rt.textContent=lang().replay||LANG.en.replay; rt.style.display="block"; });
  document.addEventListener("flyline:replaydone",()=>{ rt.style.display="none"; });
  refreshMenuStats();
  applyLanguage();
}

// first-play coach mark: shows once per flag, dismiss on click or after 9s
function coach(flag,html,top){
  if(localStorage.getItem(flag)) return;
  try{ localStorage.setItem(flag,"1"); }catch(e){}
  const c=document.createElement("div");
  c.id="coach"; if(top) c.classList.add("top");
  c.innerHTML=html+`<span class="ok">${lang().coachGot||LANG.en.coachGot}</span>`;
  $("hud").appendChild(c);
  const kill=()=>{ if(c.parentNode) c.remove(); };
  c.addEventListener("click",kill);
  setTimeout(kill,9000);
}

function makeVignette(){
  const v=document.createElement("div");
  v.id="__vignette";
  v.style.cssText="position:absolute;inset:0;pointer-events:none;opacity:0;transition:opacity .15s;"+
    "box-shadow:inset 0 0 120px 40px rgba(168,57,74,.55);";
  document.getElementById("gameWrap").appendChild(v);
  window.__vignette=v;
}

// ---------------- menu ----------------
function refreshMenuStats(){
  const s=gameScene.getStats();
  const el=$("mLineage");
  el.innerHTML=s.genNumber>1
    ? `<span class="chip">Generation <b>${s.genNumber}</b></span><span class="chip">Lineage <b class="c-egg">${s.lineageEggs}</b> eggs</span>`+
      `<span class="chip">Best <b>${s.bestEggs}</b>/gen</span><span class="chip">Mutations <b>${s.ownedTraits.length}</b></span>`
    : `<span class="chip">New lineage · Generation 1</span>`;
  $("mStart").textContent=s.genNumber>1?lang().continue(s.genNumber):lang().start;
}

function wireMenu(){
  $("mStart").addEventListener("click",()=>{
    sfx.uiTick();
    $("menu").classList.remove("show");
    $("hud").classList.remove("hidden");
    gameScene.beginRun();
    // step-1 coach: first-ever run
    if(gameScene.state.genNumber===1&&gameScene.state.ownedTraits.length===0&&!gameScene.__bench)
      coach("flyline_ob1",lang().coach1||LANG.en.coach1);
  });
  $("mReset").addEventListener("click",()=>{
    if(confirm("Clear the lineage save and restart from Generation 1?")){
      gameScene.wipeSave(); location.reload();
    }
  });
  // circuit toggle
  document.querySelectorAll(".circBtn").forEach(b=>{
    b.classList.toggle("active",b.dataset.conn===gameScene.state.connectivityMode);
    b.addEventListener("click",()=>{
      gameScene.setConnectivity(b.dataset.conn);
      document.querySelectorAll(".circBtn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
      sfx.uiTick(); addLog("Connectivity set to "+(b.dataset.conn==="real"?lang().real:lang().shuffled)+".");
    });
  });
  // brain selection
  document.querySelectorAll(".brainBtn:not([disabled])").forEach(b=>{
    b.classList.toggle("active",b.dataset.brain===gameScene.playerBrainId);
    b.addEventListener("click",()=>{
      gameScene.attachBrain(b.dataset.brain);
      document.querySelectorAll(".brainBtn").forEach(x=>x.classList.remove("active"));
      b.classList.add("active");
    });
  });
  // judgment-layer key: empty → local heuristic; set → pinned jev via proxy
  const jk=$("jevKey");
  if(jk){
    jk.value=localStorage.getItem("flyline_jev_key")||"";
    jk.addEventListener("change",()=>{
      const v=jk.value.trim();
      if(v) localStorage.setItem("flyline_jev_key",v);
      else localStorage.removeItem("flyline_jev_key");
      const sub=$("judgmentSub");
      if(sub) sub.textContent=v?lang().brainJudgmentKey||LANG.en.brainJudgmentKey
        :lang().brainJudgment||LANG.en.brainJudgment;
      if(gameScene.playerBrainId==="judgment") gameScene.attachBrain("judgment");
    });
  }
  document.addEventListener("flyline:brain",e=>{
    const sub=$("judgmentSub"); if(!sub) return;
    if(e.detail.id==="judgment"&&e.detail.model&&!e.detail.model.startsWith("local-heuristic"))
      sub.textContent=lang().brainJudgmentKey||LANG.en.brainJudgmentKey;
  });
  const bdl=$("hBrainDl");
  if(bdl) bdl.addEventListener("click",()=>{
    const n=gameScene.downloadDecisionLog?gameScene.downloadDecisionLog()
      :window.FlyLabAPI.downloadDecisionLog();
    addLog("Decision log downloaded · "+n+" records");
  });
  // seed
  $("seedInput").value=gameScene.state.worldSeed;
  $("seedApply").addEventListener("click",()=>{
    const v=parseInt($("seedInput").value,10);
    if(!isNaN(v)&&v>0){ gameScene.setSeed(v); addLog(lang().seed+" "+(v>>>0)+" — world reset for this generation."); }
  });
  // experiment
  $("expBtn").addEventListener("click",()=>{
    const r=runExperiment(gameScene.state.worldSeed);
    $("expResult").innerHTML=
      `Seed ${gameScene.state.worldSeed} · ${r.n} paired trials (same approach, connectivity only changes):<br>`+
      `<b class="c-teal">Real connectivity</b> escape rate <b>${r.realEscape.toFixed(0)}%</b> · average trigger lead ${r.realLead.toFixed(3)}s<br>`+
      `<b class="c-lav">Swapped connectivity</b> escape rate <b>${r.shufEscape.toFixed(0)}%</b> · average trigger lead ${r.shufLead.toFixed(3)}s<br>`+
      `<b class="c-gold">LC4 angular velocity leads LPLC2 looming size: real connectivity puts more weight on speed, triggering escape earlier; swapped connectivity puts more weight on size, triggering too late. A simplified two-channel assay — change the seed to rerun.</b>`;
  });
}

const EN_TRAIT={
  white:["White eye","Sense range +25%","Night sense penalty ×2"], curly:["Curly wing","Speed +18%","Metabolism +15%"], vestigial:["Vestigial wing","Energy cap +60; metabolism -10%","GF jump distance -40%"],
  ebony:["Ebony","Predator damage -30%","Sense -12%"], fecund:["Fecund","Egg cost -22%","Egg laying exposes odor for 2s"], swift:["Swift","Dash cooldown -30%","Dash cost +40%"], hardy:["Hardy","Metabolism -16%","Speed -8%"],
  nocturnal:["Nocturnal","No night sense penalty",""], shaker:["Shaker","Speed +40% for 1.5s after GF escape",""], forager:["Forager","Food energy +35%","Speed -18% for 1s after feeding"], thrift:["Thrift","Rot does not expose odor",""],
  tiger:["Tiger","Bite knocks back and stuns predator",""], giant:["Giant","Energy cap +60; GF reflex easier to trigger","Speed -15%"], rover:["Rover","Speed +10%; food sense +20%","Metabolism +12%"], sitter:["Sitter","Food respawns in place; feeding +25%","Speed -10%"],
  mimic:["Mimic","Predator loses you while still","Stillness does not reduce metabolism"], cannibal:["Cannibal","Drain rival energy and slow it","Feeding exposes odor"], diapause:["Diapause","Below 30 energy: metabolism -60%; predator interest -50%","Speed -40%; no jump while active"],
  adh:["Adh","Rot grants 4s intoxicated sprint; no odor","Turning is sluggish while intoxicated"], phototax:["Phototaxis","Inside the light: metabolism -30%","Night light attraction"], guard:["Guard","Predator prioritizes wild type near your eggs","Predator can eat your eggs"], clock:["Clock","Day metabolism -20%","Night metabolism +20%; sense -10%"], hopper:["Hopper","Jump at any time","Active jump costs ×1.5 and cooldown +50%"], pheromone:["Pheromone","Detect rival egg sites; food there +50% for 3s","Your eggs broadcast too"]
};
function traitCopy(t){
  if(language!=="en") return {name:TRAIT_INFO[t].name,good:TRAIT_INFO[t].good,bad:TRAIT_INFO[t].bad,syn:TRAIT_INFO[t].syn};
  const e=EN_TRAIT[t]; return {name:e?.[0]||TRAIT_INFO[t].name,good:e?.[1]||TRAIT_INFO[t].good,bad:e?.[2]||TRAIT_INFO[t].bad,syn:""};
}

// ---------------- draft ----------------
function showDraft(d){
  if(gameScene.__bench) return; // bench mode steps generations without UI modals
  const en=language==="en";
  coach("flyline_ob3",lang().coach3||LANG.en.coach3,true);
  $("dTitle").textContent=`Generation ${d.gen} · Complete`;
  const v=$("dVerdict");
  v.textContent=d.win?`Beat wild type ${d.eggs} : ${d.rivalEggs}`:`Lost to wild type ${d.eggs} : ${d.rivalEggs}`;
  v.className="verdict "+(d.win?"win":"lose");
  $("dRep").innerHTML=`Offspring this generation <b class="c-egg">${d.eggs}</b> · Total lineage ${d.lineageEggs} · Best ${d.bestEggs}`+
      (d.isBest?" <b class='c-gold'>(new record!)</b>":"")+"<br>"+
      (d.alive?"You survived the full generation.":(d.deathReason==="energy"?"Energy depleted.":"The predator connected."))+" This generation is over; your offspring inherit your choice."+`<br><span class="c-teal">Next-generation lineage: ${gameScene.state.ownedTraits.length?gameScene.state.ownedTraits.map(t=>traitCopy(t).name).join(" · "):"Wild type"}</span>`;
  const wrap=$("dCards"); wrap.innerHTML="";
  d.cards.forEach(tid=>{
    const info=traitCopy(tid);
    const owned=gameScene.state.ownedTraits.filter(t=>t===tid).length;
    const el=document.createElement("div");
    el.className="mcard";
    el.innerHTML=`<div class="mname">${info.name}${owned?` <span class="cnt" style="color:var(--gold)">×${owned}</span>`:""}</div>`+
      `<div class="mdesc"><span class="mgood">${info.good}</span>${info.bad?`<br><span class="mbad">${info.bad}</span>`:""}</div>`+
      (info.syn?`<div class="msyn">⚙ ${info.syn}</div>`:"");
    el.addEventListener("click",()=>{
      sfx.draftPick();
      $("draft").classList.remove("show");
      gameScene.nextGen(tid);
      refreshTraits();
    });
    wrap.appendChild(el);
  });
  $("dRival").textContent=`Wild type has accumulated ${gameScene.rivalFly.rivalTraits.length} mutations — it evolves too.`;
  document.querySelectorAll(".brainReport").forEach(e=>e.remove());
  document.querySelectorAll(".questLine").forEach(e=>e.remove());
  {
    // quest status on every draft screen: no one should have to wonder
    // whether the mint quests noticed their run
    let store={}; try{ store=JSON.parse(localStorage.getItem("flyline_quests_v1")||"{}"); }catch(_){}
    const mark=q=>store[q]?"✓":"✗";
    const el=document.createElement("div");
    el.className="tiny questLine";
    el.innerHTML=`DISH quests — SURVIVOR ${mark("SURVIVOR")} · FORAGER ${mark("FORAGER")} (${Math.min(d.eggs,3)}/3 eggs) · REFLEX ${mark("REFLEX")} (${Math.min(d.escapes||0,3)}/3 escapes) · EXAMINED ${mark("EXAMINED")} (<a href="?bench=1&seed=42&brain=circuit&gens=2" target="_blank" rel="noreferrer">exam room</a>) — any one unlocks the free mint`;
    $("dRival").after(el);
  }
  if(d.brain&&d.brain.id!=="manual"&&d.brain.decisions>0){
    const bl=document.createElement("div");
    bl.className="tiny brainReport";
    bl.innerHTML=`Brain: <b class="c-gold">${d.brain.model||d.brain.id}</b> · ${d.brain.decisions} decisions · avg confidence ${d.brain.avgConfidence!=null?d.brain.avgConfidence.toFixed(2):"—"}`;
    $("dRival").after(bl);
  }
  const oldBtn=$("dDeath"); if(oldBtn) oldBtn.remove();
  if(d.deathReason==="predator"){
    const btn=document.createElement("button");
    btn.id="dDeath"; btn.type="button";
    btn.textContent=lang().deathCopy||LANG.en.deathCopy;
    btn.addEventListener("click",()=>{
      const s=gameScene.state.worldSeed>>>0;
      const t=(GEN_DURATION-Math.max(0,gameScene.genTimeLeft)).toFixed(1);
      const challenge=
        `Fruit Fly World — death challenge\n`+
        `seed ${s} · gen ${d.gen} · killed by the predator at ${t}s · ${d.eggs} eggs this generation\n`+
        `Same world, same pressure — keep the fly alive:\n`+
        `https://fruitfly.world/play?seed=${s}`;
      navigator.clipboard.writeText(challenge).then(()=>{
        btn.textContent=lang().deathCopied||LANG.en.deathCopied;
        setTimeout(()=>{ btn.textContent=lang().deathCopy||LANG.en.deathCopy; },2500);
      }).catch(()=>{ /* clipboard blocked: the report itself is still screenshottable */ });
    });
    $("dRival").after(btn);
  }
  const showNow=()=>{ $("draft").classList.add("show"); sfx.draftShow(); };
  if(d.deathReason==="predator"&&gameScene.playDeathReplay) gameScene.playDeathReplay(showNow);
  else showNow();
}

function onGenStart(d){
  refreshTraits();
  addLog(`— Generation ${d.gen} begins —`);
  if(d.gen>1){
    const pct=Math.min(80,5*(d.gen-1));
    addLog(`Generation ${d.gen}: the predator is ${pct}% faster and safe food is scarcer.`);
  }
}

// ---------------- HUD extras ----------------
function wireHud(){
  $("hPause").addEventListener("click",()=>{
    gameScene.setPaused(true);
    $("menu").classList.add("show");
    refreshMenuStats();
    $("mStart").textContent=lang().continue(gameScene.state.genNumber);
  });
  refreshTraits();
}
function refreshTraits(){
  const counts={};
  gameScene.state.ownedTraits.forEach(t=>counts[t]=(counts[t]||0)+1);
  const el=$("hTraits");
  el.innerHTML=Object.keys(counts).map(t=>
    `<span class="traitchip"><b>${traitCopy(t).name}</b>${counts[t]>1?` <span class="cnt">×${counts[t]}</span>`:""}</span>`
  ).join("");
}
function addLog(msg){
  const el=$("hLog");
  const div=document.createElement("div");
  div.textContent=trLog(msg);
  el.prepend(div);
  while(el.children.length>8) el.lastChild.remove();
}

// ---------------- touch ----------------
function wireTouch(){
  const isTouch=("ontouchstart" in window)||navigator.maxTouchPoints>0;
  if(!isTouch) return;
  document.body.classList.add("touch");
  gameScene.isTouch=true;
  // first-use hint: the joystick is invisible until touched, so tell the player
  const hint=document.createElement("div");
  hint.id="touchHint"; hint.textContent=lang().touchHint||LANG.en.touchHint;
  $("hud").appendChild(hint); hint.style.display="block";
  const zone=$("joyZone"), base=$("joyBase"), knob=$("joyKnob");
  let jid=null, cx=0, cy=0;
  const R=44;
  zone.addEventListener("touchstart",e=>{
    const t=e.changedTouches[0]; jid=t.identifier;
    cx=t.clientX; cy=t.clientY;
    base.style.display="block";
    base.style.left=(cx-55)+"px"; base.style.top=(cy-55)+"px";
    e.preventDefault();
  },{passive:false});
  zone.addEventListener("touchmove",e=>{
    for(const t of e.changedTouches){
      if(t.identifier!==jid) continue;
      let dx=t.clientX-cx, dy=t.clientY-cy;
      const m=Math.hypot(dx,dy);
      if(m>R){ dx=dx/m*R; dy=dy/m*R; }
      knob.style.left=(31+dx)+"px"; knob.style.top=(31+dy)+"px";
      gameScene.touchVec={x:dx/R,y:dy/R};
      if(hint.style.display!=="none") hint.style.display="none";
    }
    e.preventDefault();
  },{passive:false});
  const end=e=>{
    for(const t of e.changedTouches){
      if(t.identifier!==jid) continue;
      jid=null; base.style.display="none";
      knob.style.left="31px"; knob.style.top="31px";
      gameScene.touchVec=null;
    }
  };
  zone.addEventListener("touchend",end); zone.addEventListener("touchcancel",end);
  $("gfBtn").addEventListener("touchstart",e=>{ e.preventDefault(); gameScene.tryDash(gameScene.playerFly); },{passive:false});
}
