// ui.js — DOM overlay logic: menu, draft cards, HUD extras, touch joystick. Bridges DOM ↔ GameScene.
import { TRAIT_INFO, runExperiment, GEN_DURATION } from "./sim.js";
import { sfx } from "./audio.js";

const $=id=>document.getElementById(id);
let gameScene=null;
let language=localStorage.getItem("flyline_language")||"en";
const LANG={
  en:{label:"Language",start:"Start first generation →",continue:g=>`Continue generation ${g} →`,reset:"Clear lineage save",pause:"Pause / menu",subtitle:"Fruit-fly lineage · biological survival game",intro:"You are a lineage, not a single fly. Gather food and energy → lay eggs automatically; the predator commits to a ballistic strike. When the GF reflex lights up READY, press Space to jump.",phone:"Mobile: hold and drag anywhere to steer; tap GF when it lights up.",food:"Food: sugar +12 (safe) · yeast +26 (rim, predator risk) · rot +38 (odor exposure).",circuit:"Escape circuit · connectome-inspired",real:"Real connectivity",shuffled:"Shuffled connectivity",seed:"Set seed",experiment:"Run control experiment · real vs shuffled",draftPrompt:"What will this generation leave behind? Choose one mutation for the next generation.",touchHint:"Hold and drag anywhere to steer",brainTitle:"Choose your fly's brain",brainNote:"Same world, same rules. The brain only decides where to go — the GF brainstem still owns the escape jump.",brainManual:"You drive · WASD",brainGenes:"auto-pilot baseline",brainCircuit:"FFW-CX/0.1 · 24 neurons",brainJudgment:"local heuristic · free",brainJudgmentKey:"System One · jev-1.13.0",brainKeyLabel:"System One key",brainKeyNote:"jev-1.13.0 via same-origin /api/jev proxy · key stored in this browser only · on failure the local heuristic takes over",brainDl:"⤓ log",brainLine:`Brain this generation`,coach1:"<b>MOVE & EAT</b> — steer toward the green sugar. Energy above the line becomes eggs automatically.",coach2:"<b>ESCAPE</b> — the predator just committed. Wait for <b>GF READY</b>, then press SPACE (or tap the GF button) to jump clear.",coach3:"<b>DRAFT</b> — pick ONE mutation: it is the body your next fly is born with. The wild type evolves too.",coachGot:"GOT IT — tap to dismiss",replay:"◉ DEATH REPLAY ×0.5",deathCopy:"COPY DEATH AS CHALLENGE",deathCopied:"COPIED ✓ — PASTE IT ANYWHERE",esc:`The predator is now faster and safe food is scarcer.`},
  zh:{label:"语言",start:"开始第一代 →",continue:g=>`继续第 ${g} 代 →`,reset:"清空血脉存档",pause:"暂停/菜单",subtitle:"果蝇血脉 · 生物学生存游戏",intro:"你是一条血脉,不是一只苍蝇。觅食攒能量 → 自动产卵;捕食者会锁定弹道扑杀你。GF 反射亮起「就绪」时按空格起跳。",phone:"手机:按住屏幕任意处拖动 = 飞行方向;GF 按钮发光时点它。",food:"食物:糖 +12(安全) · 酵母 +26(盘缘,有风险) · 腐物 +38(气味暴露)。",circuit:"逃逸回路 · connectome-inspired",real:"真实连接",shuffled:"打乱连接",seed:"设种子",experiment:"跑对照实验 · 真实 vs 打乱",draftPrompt:"这一代留下什么？选择一个突变，传给下一代",touchHint:"按住屏幕任意处拖动 = 飞行方向",brainTitle:"选你果蝇的大脑",brainNote:"同一个世界、同一套规则。大脑只决定往哪飞——逃逸起跳仍然归脑干(GF 反射)管。",brainManual:"你自己开 · WASD",brainGenes:"基因自动驾驶",brainCircuit:"FFW-CX/0.1 · 24 神经元",brainJudgment:"本地启发式 · 免费",brainJudgmentKey:"System One · jev-1.13.0",brainKeyLabel:"System One 密钥",brainKeyNote:"jev-1.13.0 走同源 /api/jev 代理 · 密钥只存本浏览器 · 远端失败自动换本地启发式",brainDl:"⤓ 日志",brainLine:`本代大脑`,coach1:"<b>移动 & 觅食</b> — 飞向绿色糖点。能量过线会自动产卵。",coach2:"<b>逃生</b> — 捕食者扑过来了。等 <b>GF READY</b> 亮起,按空格(或点 GF 按钮)跳开。",coach3:"<b>选突变</b> — 选一个突变:它就是下一代果蝇的身体。野生型也在进化。",coachGot:"知道了 — 点一下关闭",replay:"◉ 死亡回放 ×0.5",deathCopy:"复制死亡挑战",deathCopied:"已复制 ✓ — 去粘贴吧",esc:`捕食者更快了,安全食物也更少了。`},
  ja:{label:"言語",start:"第1世代を開始 →",continue:g=>`${g}世代を続ける →`,reset:"血統データを消去",pause:"一時停止 / メニュー",subtitle:"ショウジョウバエの血統 · 生存ゲーム",intro:"あなたは一匹ではなく血統です。餌とエネルギーを集めて産卵し、捕食者の確定弾道をGF反射で避けましょう。",phone:"モバイル:画面を押してドラッグして操縦。GFボタンが光ったらタップ。",food:"餌:砂糖 +12 · 酵母 +26 · 腐敗物 +38。",circuit:"脱出回路 · connectome-inspired",real:"実際の接続",shuffled:"シャッフル接続",seed:"シード設定",experiment:"対照実験を実行",draftPrompt:"この世代に何を残す？次世代へ渡す変異を1つ選択",touchHint:"画面を押してドラッグして操縦"},
  ko:{label:"언어",start:"첫 세대 시작 →",continue:g=>`${g}세대 계속 →`,reset:"혈통 저장 삭제",pause:"일시정지 / 메뉴",subtitle:"초파리 혈통 · 생존 게임",intro:"당신은 한 마리가 아니라 혈통입니다. 먹이와 에너지를 모아 알을 낳고 GF 반사로 포식자를 피하세요.",phone:"모바일: 화면을 누르고 드래그해 조종하세요. GF 버튼이 빛나면 누르세요.",food:"먹이: 설탕 +12 · 효모 +26 · 부패물 +38.",circuit:"탈출 회로 · connectome-inspired",real:"실제 연결",shuffled:"셔플 연결",seed:"시드 설정",experiment:"대조 실험 실행"},
  es:{label:"Idioma",start:"Empezar primera generación →",continue:g=>`Continuar generación ${g} →`,reset:"Borrar linaje",pause:"Pausa / menú",subtitle:"Linaje de moscas · juego de supervivencia",intro:"Eres un linaje, no una sola mosca. Busca alimento, acumula energía y pon huevos; evita el ataque balístico con el reflejo GF.",phone:"Móvil: mantén pulsado y arrastra para volar. Toca GF cuando se ilumine.",food:"Comida: azúcar +12 · levadura +26 · putrefacto +38.",circuit:"Circuito de escape · connectome-inspired",real:"Conexión real",shuffled:"Conexión mezclada",seed:"Fijar semilla",experiment:"Ejecutar experimento"}
};
function lang(){return LANG[language]||LANG.en;}
function applyLanguage(){
  const l=lang(); document.documentElement.lang=language;
  $("languageSelect").value=language; $("languageControl").querySelector("label").textContent=l.label;
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
  if(language!=="en") return msg;
  const replacements={
    "连接组切到「真实连接」":"Connectivity set to Real",
    "连接组切到「打乱连接」":"Connectivity set to Shuffled",
    "种子设为 ":"Seed set to ",
    "—— 第 ":"— Generation ",
    " 第 ":" Generation ",
    "代开始 ——":" begins —",
    "野生型也进化了:":"Wild type evolved: ",
    "信息素：野生型会追踪你的卵堆。":"Pheromone: the wild type will track your egg cluster.",
    "信息素：发现野生型卵堆，附近食物奖励 +50% 3s。":"Pheromone: rival egg cluster found; nearby food gives +50% for 3s.",
    "产卵!后代 +1(第 ":"Egg laid! +1 offspring (egg ",
    "枚)":" )",
    "能量耗尽,这一代结束。":"Energy depleted. This generation is over.",
    "被捕食者杀死了。":"The predator killed you.",
    "这一代撑过了 50 秒。":"You survived the full 50 seconds.",
    "这一代结束,但你的血脉还在。":"This generation ended, but your lineage continues.",
    "滞育启动：代谢降低,但行动变慢。":"Diapause active: lower metabolism, slower movement.",
    "跳跃者：主动逃逸消耗更高。":"Hopper: active escapes cost more energy.",
    "虎纹 tiger 反击:击退并震慑捕食者!":"Tiger counterattack: the predator was knocked back!",
    "被扑杀命中!":"The committed strike connected!",
    "等右下 GF 按钮发光亮起时立刻点它,就能跳开。":"Tap GF when the button lights up to jump clear.",
    "GF 反射亮起时按空格,时机对了就能躲开弹道。":"Press Space when the GF reflex lights up to dodge the ballistic strike.",
    "野生型也进化了:":"Wild type evolved:"
  };
  for(const [from,to] of Object.entries(replacements)) msg=msg.replace(from,to);
  return msg;
}


export function initUI(scene){
  gameScene=scene;
  makeVignette();
  wireMenu();
  wireHud();
  wireTouch();
  document.addEventListener("flyline:log",e=>addLog(e.detail));
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
  $("languageSelect").addEventListener("change",e=>{
    language=e.target.value;
    localStorage.setItem("flyline_language",language);
    applyLanguage();
  });
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
    ? `<span class="chip">${language==="en"?"Generation":"第"} <b>${s.genNumber}</b>${language==="en"?"":" 代"}</span><span class="chip">${language==="en"?"Lineage":"血脉"} <b class="c-egg">${s.lineageEggs}</b> ${language==="en"?"eggs":"卵"}</span>`+
      `<span class="chip">${language==="en"?"Best":"纪录"} <b>${s.bestEggs}</b>/${language==="en"?"gen":"代"}</span><span class="chip">${language==="en"?"Mutations":"突变"} <b>${s.ownedTraits.length}</b></span>`
    : `<span class="chip">${language==="en"?"New lineage · Generation 1":"新血脉 · 第 1 代"}</span>`;
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
    if(confirm(language==="en"?"Clear the lineage save and restart from Generation 1?":"清空血脉存档、从第 1 代重开吗?")){
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
      sfx.uiTick(); addLog("连接组切到「"+(b.dataset.conn==="real"?lang().real:lang().shuffled)+"」");
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
    addLog((language==="en"?"Decision log downloaded · ":"决策日志已下载 · ")+n+" records");
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
      `<b class="c-lav">Shuffled connectivity</b> escape rate <b>${r.shufEscape.toFixed(0)}%</b> · average trigger lead ${r.shufLead.toFixed(3)}s<br>`+
      `<b class="c-gold">LC4 angular velocity leads LPLC2 looming size: real connectivity puts more weight on speed, triggering escape earlier; shuffled connectivity puts more weight on size, triggering too late. Change the seed to rerun.</b>`;
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
  $("dTitle").textContent=en?`Generation ${d.gen} · Complete`:`第 ${d.gen} 代 · 结束`;
  const v=$("dVerdict");
  v.textContent=en?(d.win?`Beat wild type ${d.eggs} : ${d.rivalEggs}`:`Lost to wild type ${d.eggs} : ${d.rivalEggs}`):(d.win?`战胜野生型 ${d.eggs} : ${d.rivalEggs}`:`败给野生型 ${d.eggs} : ${d.rivalEggs}`);
  v.className="verdict "+(d.win?"win":"lose");
  $("dRep").innerHTML=en
    ? `Offspring this generation <b class="c-egg">${d.eggs}</b> · Total lineage ${d.lineageEggs} · Best ${d.bestEggs}`+
      (d.isBest?" <b class='c-gold'>(new record!)</b>":"")+"<br>"+
      (d.alive?"You survived the full generation.":(d.deathReason==="energy"?"Energy depleted.":"The predator connected."))+" This generation is over; your offspring inherit your choice."+`<br><span class="c-teal">Next-generation lineage: ${gameScene.state.ownedTraits.length?gameScene.state.ownedTraits.map(t=>traitCopy(t).name).join(" · "):"Wild type"}</span>`
    : `这一代后代 <b class="c-egg">${d.eggs}</b> 枚 · 血脉总数 ${d.lineageEggs} · 纪录 ${d.bestEggs}`+
      (d.isBest?" <b class='c-gold'>(刷新!)</b>":"")+"<br>"+
      (d.alive?"你熬到了时间结束。":(d.deathReason==="energy"?"能量耗尽。":"捕食者命中了你。"))+" 这一代结束,后代继承你的选择。"+`<br><span class="c-teal">下一代血脉：${gameScene.state.ownedTraits.length?gameScene.state.ownedTraits.map(t=>TRAIT_INFO[t].name.split(" ")[0]).join(" · "):"野生型"}</span>`;
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
  $("dRival").textContent=en?`Wild type has accumulated ${gameScene.rivalFly.rivalTraits.length} mutations — it evolves too.`:`野生型已积累 ${gameScene.rivalFly.rivalTraits.length} 个突变 — 它也在进化。`;
  document.querySelectorAll(".brainReport").forEach(e=>e.remove());
  if(d.brain&&d.brain.id!=="manual"&&d.brain.decisions>0){
    const bl=document.createElement("div");
    bl.className="tiny brainReport";
    bl.innerHTML=en
      ?`Brain: <b class="c-gold">${d.brain.model||d.brain.id}</b> · ${d.brain.decisions} decisions · avg confidence ${d.brain.avgConfidence!=null?d.brain.avgConfidence.toFixed(2):"—"}`
      :`大脑: <b class="c-gold">${d.brain.model||d.brain.id}</b> · 共 ${d.brain.decisions} 次判断 · 平均置信度 ${d.brain.avgConfidence!=null?d.brain.avgConfidence.toFixed(2):"—"}`;
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
  addLog(language==="en"?`— Generation ${d.gen} begins —`:`—— 第 ${d.gen} 代开始 ——`);
  if(d.gen>1){
    const pct=Math.min(80,5*(d.gen-1));
    addLog(language==="en"
      ?`Generation ${d.gen}: the predator is ${pct}% faster and safe food is scarcer.`
      :`第 ${d.gen} 代:捕食者提速 ${pct}%,安全食物更少了。`);
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
