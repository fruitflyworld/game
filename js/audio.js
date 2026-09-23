// audio.js — zero-asset WebAudio SFX synthesizer. Every sound is generated, nothing is loaded.
export class Sfx {
  constructor(){ this.ctx=null; this.master=null; this.muted=false; }
  ensure(){
    if(this.ctx) return true;
    try{
      this.ctx=new (window.AudioContext||window.webkitAudioContext)();
      this.master=this.ctx.createGain(); this.master.gain.value=0.5; this.master.connect(this.ctx.destination);
    }catch(e){ return false; }
    return true;
  }
  resume(){ if(this.ctx&&this.ctx.state==="suspended") this.ctx.resume(); }
  setMuted(m){ this.muted=m; if(this.master) this.master.gain.value=m?0:0.5; }

  // --- primitives ---
  tone({freq=440,end=freq,type="sine",dur=0.15,vol=0.3,delay=0,curve="exp"}={}){
    if(!this.ensure()||this.muted) return;
    const t0=this.ctx.currentTime+delay;
    const o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t0);
    if(end!==freq) (curve==="exp"?o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t0+dur)
                                   :o.frequency.linearRampToValueAtTime(end,t0+dur));
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(vol,t0+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    o.connect(g); g.connect(this.master); o.start(t0); o.stop(t0+dur+0.05);
  }
  noise({dur=0.2,vol=0.25,delay=0,lp=1200,lpEnd=null,hp=0}={}){
    if(!this.ensure()||this.muted) return;
    const t0=this.ctx.currentTime+delay;
    const n=Math.floor(this.ctx.sampleRate*dur);
    const buf=this.ctx.createBuffer(1,n,this.ctx.sampleRate);
    const d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=Math.random()*2-1;
    const src=this.ctx.createBufferSource(); src.buffer=buf;
    const f=this.ctx.createBiquadFilter(); f.type="lowpass"; f.frequency.setValueAtTime(lp,t0);
    if(lpEnd) f.frequency.exponentialRampToValueAtTime(lpEnd,t0+dur);
    const g=this.ctx.createGain();
    g.gain.setValueAtTime(0.0001,t0);
    g.gain.exponentialRampToValueAtTime(vol,t0+0.01);
    g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
    let node=src;
    if(hp>0){ const h=this.ctx.createBiquadFilter(); h.type="highpass"; h.frequency.value=hp; node.connect(h); node=h; }
    node.connect(f); f.connect(g); g.connect(this.master); src.start(t0); src.stop(t0+dur+0.05);
  }

  // --- game events ---
  eat(type){
    if(type==="sugar"){ this.tone({freq:620,end:880,type:"sine",dur:0.09,vol:0.22}); }
    else if(type==="yeast"){ this.tone({freq:520,end:780,type:"triangle",dur:0.09,vol:0.26});
      this.tone({freq:780,end:1040,type:"triangle",dur:0.1,vol:0.22,delay:0.07}); }
    else { this.tone({freq:300,end:180,type:"sawtooth",dur:0.16,vol:0.2});
      this.tone({freq:150,end:90,type:"sine",dur:0.22,vol:0.24,delay:0.06}); }
  }
  odor(){ this.noise({dur:0.5,vol:0.12,lp:500,lpEnd:150}); this.tone({freq:220,end:150,type:"triangle",dur:0.4,vol:0.12}); }
  egg(){ this.tone({freq:900,end:1400,type:"sine",dur:0.07,vol:0.2}); this.noise({dur:0.04,vol:0.14,lp:3000}); }
  gfReady(){ this.tone({freq:1180,type:"square",dur:0.05,vol:0.12}); this.tone({freq:1560,type:"square",dur:0.07,vol:0.1,delay:0.05}); }
  dash(){ this.noise({dur:0.22,vol:0.3,lp:2600,lpEnd:400}); }
  lunge(){ this.tone({freq:200,end:55,type:"sawtooth",dur:0.28,vol:0.34}); this.noise({dur:0.18,vol:0.2,lp:900,lpEnd:200}); }
  bite(){ this.noise({dur:0.12,vol:0.4,lp:2500,hp:300}); this.tone({freq:120,end:60,type:"sine",dur:0.18,vol:0.36}); }
  tiger(){ [660,880,1320].forEach((f,i)=>this.tone({freq:f,type:"square",dur:0.07,vol:0.16,delay:i*0.06}));
    this.noise({dur:0.15,vol:0.2,lp:4000}); }
  death(){ this.tone({freq:300,end:70,type:"triangle",dur:0.7,vol:0.3}); this.noise({dur:0.4,vol:0.15,lp:600,lpEnd:120,delay:0.05}); }
  draftPick(){ [523,659,784].forEach((f,i)=>this.tone({freq:f,type:"triangle",dur:0.12,vol:0.2,delay:i*0.07})); }
  draftShow(){ this.tone({freq:392,type:"triangle",dur:0.1,vol:0.16}); this.tone({freq:523,type:"triangle",dur:0.12,vol:0.16,delay:0.08}); }
  genEnd(win){ const notes=win?[523,659,784,1046]:[392,330,262]; notes.forEach((f,i)=>this.tone({freq:f,type:"triangle",dur:0.22,vol:0.2,delay:i*0.12})); }
  uiTick(){ this.tone({freq:880,type:"sine",dur:0.04,vol:0.12}); }
}
export const sfx=new Sfx();
