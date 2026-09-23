// scene-boot.js — generate ALL textures procedurally (zero image assets).
import { TRAIT_INFO } from "./sim.js";

export class BootScene extends Phaser.Scene {
  constructor(){ super("Boot"); }

  create(){
    this.makeTextures();
    this.scene.start("Game");
  }

  canvasTex(key, w, h, drawFn){
    const tex=this.textures.createCanvas(key, w, h);
    const ctx=tex.getContext();
    ctx.clearRect(0,0,w,h);
    drawFn(ctx, w, h);
    tex.refresh();
  }

  makeTextures(){
    // particle dot (tintable white)
    this.canvasTex("dot", 12, 12, (c)=>{
      const g=c.createRadialGradient(6,6,0,6,6,6);
      g.addColorStop(0,"rgba(255,255,255,1)"); g.addColorStop(1,"rgba(255,255,255,0)");
      c.fillStyle=g; c.beginPath(); c.arc(6,6,6,0,Math.PI*2); c.fill();
    });

    // soft glow (tintable)
    this.canvasTex("glow", 128, 128, (c)=>{
      const g=c.createRadialGradient(64,64,0,64,64,64);
      g.addColorStop(0,"rgba(255,255,255,.9)"); g.addColorStop(.4,"rgba(255,255,255,.25)"); g.addColorStop(1,"rgba(255,255,255,0)");
      c.fillStyle=g; c.beginPath(); c.arc(64,64,64,0,Math.PI*2); c.fill();
    });

    // fly body variants (top-down anatomy): amber player / lavender rival
    const fly=(key, body, stripe, eyeC)=>this.canvasTex(key, 44, 56, (c)=>{
      c.translate(22,28);
      // abdomen: light plate + dark bands (posterior half)
      c.fillStyle=body; c.beginPath(); c.ellipse(0,13,9,13,0,0,Math.PI*2); c.fill();
      c.fillStyle="rgba(0,0,0,.45)";
      [-2,3,8].forEach((y,i)=>{ c.beginPath(); c.ellipse(0,13+y,8.4-i*1.4,2.2,0,0,Math.PI*2); c.fill(); });
      // thorax with dorsocentral stripes
      c.fillStyle=stripe; c.beginPath(); c.ellipse(0,0,8.5,7,0,0,Math.PI*2); c.fill();
      c.strokeStyle="rgba(0,0,0,.4)"; c.lineWidth=1;
      [-3,0,3].forEach(x=>{ c.beginPath(); c.moveTo(x,-5); c.lineTo(x,5); c.stroke(); });
      // head + eyes
      c.fillStyle=stripe; c.beginPath(); c.arc(0,-9,5,0,Math.PI*2); c.fill();
      c.fillStyle=eyeC;
      c.beginPath(); c.arc(-3.4,-10,2.8,0,Math.PI*2); c.fill();
      c.beginPath(); c.arc(3.4,-10,2.8,0,Math.PI*2); c.fill();
      c.fillStyle="rgba(255,255,255,.5)";
      c.beginPath(); c.arc(-4,-11,.9,0,Math.PI*2); c.fill();
      c.beginPath(); c.arc(2.8,-11,.9,0,Math.PI*2); c.fill();
    });
    fly("fly-p", "#c98f3e", "#a86e2c", "#8e2f1d");
    fly("fly-r", "#8d7bb8", "#6e5e9c", "#5a2440");

    // wing (translucent blade with costal margin)
    this.canvasTex("wing", 46, 22, (c)=>{
      c.translate(23,11);
      const g=c.createLinearGradient(0,0,20,0);
      g.addColorStop(0,"rgba(235,240,235,.85)"); g.addColorStop(1,"rgba(235,240,235,.28)");
      c.fillStyle=g;
      c.beginPath(); c.moveTo(-20,0); c.quadraticCurveTo(0,-10,22,-2); c.quadraticCurveTo(0,8,-20,0); c.fill();
      c.strokeStyle="rgba(255,255,255,.65)"; c.lineWidth=1.2;
      c.beginPath(); c.moveTo(-20,0); c.quadraticCurveTo(0,-10,22,-2); c.stroke();
    });

    // spider predator
    this.canvasTex("spider", 110, 110, (c)=>{
      c.translate(55,55);
      const g=c.createRadialGradient(0,0,2,0,0,26);
      g.addColorStop(0,"#d4485c"); g.addColorStop(1,"#5c1622");
      c.fillStyle=g; c.beginPath(); c.arc(0,0,26,0,Math.PI*2); c.fill();
      // marking
      c.fillStyle="rgba(0,0,0,.35)"; c.beginPath(); c.ellipse(0,4,8,12,0,0,Math.PI*2); c.fill();
      c.fillStyle="#f0e0a0";
      c.beginPath(); c.arc(9,-7,2.6,0,Math.PI*2); c.fill();
      c.beginPath(); c.arc(9,7,2.6,0,Math.PI*2); c.fill();
      c.fillStyle="rgba(255,255,255,.7)";
      c.beginPath(); c.arc(10,-8,1,0,Math.PI*2); c.fill();
      c.beginPath(); c.arc(10,8,1,0,Math.PI*2); c.fill();
    });

    // foods
    this.canvasTex("food-sugar", 26, 26, (c)=>{
      c.translate(13,13);
      [[-4,-3,4],[5,-1,3.4],[-1,5,3],[3,6,2.2]].forEach(([x,y,r])=>{
        const g=c.createRadialGradient(x-1,y-1,0,x,y,r);
        g.addColorStop(0,"#eaffdc"); g.addColorStop(1,"#7ed957");
        c.fillStyle=g; c.beginPath(); c.arc(x,y,r,0,Math.PI*2); c.fill();
      });
    });
    this.canvasTex("food-yeast", 30, 30, (c)=>{
      c.translate(15,15); c.rotate(Math.PI/4);
      const g=c.createLinearGradient(-8,-8,8,8);
      g.addColorStop(0,"#ffe2a0"); g.addColorStop(1,"#c98f2e");
      c.fillStyle=g; c.fillRect(-7,-7,14,14);
      c.fillStyle="rgba(255,255,255,.5)"; c.fillRect(-7,-7,14,3);
      c.strokeStyle="rgba(232,182,76,.9)"; c.lineWidth=2; c.strokeRect(-10,-10,20,20);
    });
    this.canvasTex("food-rot", 36, 36, (c)=>{
      c.translate(18,18);
      c.beginPath();
      for(let i=0;i<9;i++){ const a=i/9*Math.PI*2, r=9+Math.sin(i*2.3)*3;
        const x=Math.cos(a)*r, y=Math.sin(a)*r; i?c.lineTo(x,y):c.moveTo(x,y); }
      c.closePath();
      const g=c.createRadialGradient(-2,-2,1,0,0,12);
      g.addColorStop(0,"#cdb6f0"); g.addColorStop(1,"#6b4fa3");
      c.fillStyle=g; c.fill();
      c.fillStyle="rgba(40,20,60,.6)";
      c.beginPath(); c.arc(3,1,2.2,0,Math.PI*2); c.fill();
      c.beginPath(); c.arc(-3,3,1.6,0,Math.PI*2); c.fill();
    });

    // egg
    this.canvasTex("egg", 16, 20, (c)=>{
      c.translate(8,10);
      const g=c.createRadialGradient(-2,-3,1,0,0,7);
      g.addColorStop(0,"#fff3cf"); g.addColorStop(1,"#d9b45e");
      c.fillStyle=g; c.beginPath(); c.ellipse(0,0,5.5,7.5,0.2,0,Math.PI*2); c.fill();
    });

    // stink wave (odor)
    this.canvasTex("stink", 30, 30, (c)=>{
      c.translate(15,15); c.strokeStyle="rgba(180,154,232,.85)"; c.lineWidth=2;
      c.beginPath(); c.arc(0,0,4,Math.PI*0.2,Math.PI*1.1); c.stroke();
      c.beginPath(); c.arc(0,0,9,Math.PI*0.5,Math.PI*1.35); c.stroke();
    });
  }
}
