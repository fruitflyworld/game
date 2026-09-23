// main.js — Phaser bootstrap.
import { BootScene } from "./scene-boot.js";
import { GameScene } from "./scene-game.js";
import { initUI } from "./ui.js";

// portrait phones get a tall canvas so the dish fills the screen width
// (900x760 in a 390x844 viewport letterboxes the dish down to ~250px)
const isTouch=("ontouchstart" in window)||navigator.maxTouchPoints>0;
const portrait=window.innerHeight>window.innerWidth;
const GW_GH=(isTouch&&portrait)?[620,1340]:[900,760];

const config={
  type: Phaser.AUTO,
  parent: "canvasHost",
  width: GW_GH[0], height: GW_GH[1],
  backgroundColor: "#070a09",
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, GameScene]
};

const game=new Phaser.Game(config);
// initUI needs the Game scene to have finished create() (this.state exists).
const checkReady=setInterval(()=>{
  const scene=game.scene.getScene("Game");
  if(scene&&scene.state&&!scene.__uiInited){
    scene.__uiInited=true; clearInterval(checkReady); initUI(scene);
    const qp=new URLSearchParams(location.search);
    // agent hand-off: a headless autopilot run produces quest evidence the
    // operator imports by opening one URL (built by public/skill/ffw-dish)
    const imp=qp.get("import");
    if(imp){
      try{
        const r=scene.importQuests(JSON.parse(imp));
        console.log("[ffw] quest import:",JSON.stringify(r));
      }catch(e){ console.warn("[ffw] quest import failed:",e); }
      history.replaceState(null,"",location.pathname);
    }
    if(qp.get("bench")==="1"){
      import("./bench.js").then(async m=>{
        let seed=+qp.get("seed")||42, beacon=null;
        if(qp.get("seed")==="beacon"){
          // public randomness: derive the exam seed from the latest Sepolia block
          try{
            const b=await (await fetch("/api/beacon")).json();
            if(b&&typeof b.seed==="number"){ seed=b.seed>>>0; beacon=b; }
          }catch(e){ /* fall back to 42 */ }
        }
        const r=await m.runBench(scene,{
          seed,
          brain:qp.get("brain")||"circuit",
          gens:+qp.get("gens")||2 });
        m.renderBenchReport(r,beacon);
        window.FlyBenchAPI={last:()=>r};
      });
    }
  }
},50);
