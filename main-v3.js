(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const TILE = 24;
  const COLS = Math.floor(W / TILE);
  const ROWS = Math.floor(H / TILE);
  const WORLD = 60;
  const DAY_LENGTH_MS = 2 * 60 * 1000;
  const NIGHT_START = 0.55, NIGHT_END = 0.95;
  const MAX_NIGHTS = 99;

  let state;

  const ui = {
    statDay: document.getElementById('statDay'),
    statTime: document.getElementById('statTime'),
    statNightsLeft: document.getElementById('statNightsLeft'),
    statMinigames: document.getElementById('statMinigames'),
    inventory: document.getElementById('inventory'),
    crafting: document.getElementById('crafting'),
    btns: {
      help: document.getElementById('btnHelp'),
      pause: document.getElementById('btnPause'),
      restart: document.getElementById('btnRestart'),
    },
    overlay: document.getElementById('overlay'),
    overlayText: document.getElementById('overlayText'),
    overlayBtn: document.getElementById('overlayBtn'),
  };

  // Help now uses alert only (no modal exists)
  ui.btns.help.addEventListener('click', () => {
    alert("How to Play:\\n- Day/Night every 2 minutes. Avoid outside at night.\\n- Gather wood/stone. Craft shovel to dig.\\n- Beat 3 shrine mini-games for sigils. Dig for chamber, rescue child.\\n- Craft House Frame (wood20+stone10) and place it to win.\\nControls: P1 WASD/E/F, P2 Arrows/RightShift/RightCtrl. Pause=P.\\nNights limit: 99.");
  });

  function newGame() {
    state = {
      running: true,
      t0: performance.now(),
      dayCount: 1,
      nightsElapsed: 0,
      lastCycleMark: performance.now(),
      player1: {x: Math.floor(Math.random()*WORLD), y: Math.floor(Math.random()*WORLD)},
      player2: {x: Math.floor(Math.random()*WORLD), y: Math.floor(Math.random()*WORLD)},
      sharedInv: { wood:0, stone:0, shovel:0, sigils:0, child:0, houseFrame:0, houseBuilt:0 },
      shrines: [], trees: new Set(), rocks: new Set(), dug: new Set(),
      chamber: null, enemies: [], paused: false, viewTarget: 1, messages: [], minigame: null, won:false, lost:false,
    };
    placeWorld();
    message("Find 3 shrines, craft shovel, dig the chamber, rescue child, build house.");
  }

  function keyTile(x,y){ return x+\",\"+y; }
  function placeWorld(){
    const density=0.10;
    for(let x=0;x<WORLD;x++){
      for(let y=0;y<WORLD;y++){
        const r=Math.random();
        if (r<density*0.7) state.trees.add(keyTile(x,y));
        else if (r<density) state.rocks.add(keyTile(x,y));
      }
    }
    state.trees.delete(keyTile(state.player1.x,state.player1.y));
    state.rocks.delete(keyTile(state.player1.x,state.player1.y));
    const shrinePositions=[];
    for(let i=0;i<3;i++){
      let sx,sy; do{ sx=(Math.random()*WORLD)|0; sy=(Math.random()*WORLD)|0; } while(state.trees.has(keyTile(sx,sy))||state.rocks.has(keyTile(sx,sy)));
      shrinePositions.push({x:sx,y:sy,type:i});
    }
    state.shrines=shrinePositions;
    let cx,cy; do{ cx=(Math.random()*WORLD)|0; cy=(Math.random()*WORLD)|0; } while(Math.hypot(cx-state.player1.x,cy-state.player1.y)<10);
    state.chamber={x:cx,y:cy,requiredSigils:3,unlocked:false};
  }

  function isNight(){ const p=((performance.now()-state.t0)%DAY_LENGTH_MS)/DAY_LENGTH_MS; return p>=NIGHT_START && p<=NIGHT_END; }
  function phaseLabel(){ const p=((performance.now()-state.t0)%DAY_LENGTH_MS)/DAY_LENGTH_MS; if(p<0.2) return "Dawn"; if(p<NIGHT_START) return "Day"; if(p<=NIGHT_END) return "Night"; return "Dawn"; }

  function updateEnemies(){
    if (isNight()){
      if (state.enemies.length<8 && Math.random()<0.02){ state.enemies.push({x:(Math.random()*WORLD)|0,y:(Math.random()*WORLD)|0}); }
      for(const e of state.enemies){
        const t=(Math.hypot(e.x-state.player1.x,e.y-state.player1.y)<Math.hypot(e.x-state.player2.x,e.y-state.player2.y))?state.player1:state.player2;
        const dx=Math.sign(t.x-e.x), dy=Math.sign(t.y-e.y);
        if (Math.random()<0.7) e.x+=dx; if (Math.random()<0.7) e.y+=dy;
        e.x=Math.max(0,Math.min(WORLD-1,e.x)); e.y=Math.max(0,Math.min(WORLD-1,e.y));
      }
    } else if (state.enemies.length && Math.random()<0.04) state.enemies.pop();
  }

  function clamp(v,min,max){ return v<min?min:v>max?max:v; }

  const keys={};
  window.addEventListener('keydown', e=>{ keys[e.code]=true; if(e.code==='KeyP') togglePause(); });
  window.addEventListener('keyup', e=> keys[e.code]=false);

  function tryInteract(p){
    const k=keyTile(p.x,p.y);
    if (state.trees.has(k)){ state.trees.delete(k); state.sharedInv.wood++; message("+1 wood"); refreshInv(); return; }
    if (state.rocks.has(k)){ state.rocks.delete(k); state.sharedInv.stone++; message("+1 stone"); refreshInv(); return; }
    const shrine=state.shrines.find(s=>s.x===p.x&&s.y===p.y);
    if (shrine){ if (state.sharedInv.sigils>=3){ message("You already have all sigils."); } else startMinigame(shrine.type); return; }
    if (state.chamber.x===p.x && state.chamber.y===p.y){
      if (!state.chamber.unlocked){
        if (state.sharedInv.sigils>=3){ if (!state.sharedInv.child){ state.chamber.unlocked=true; state.sharedInv.child=1; message("You rescued the child! Build your house."); } }
        else message("A sealed chamber. You need 3 sigils.");
      } return;
    }
    if (state.sharedInv.child && state.sharedInv.houseFrame && !state.sharedInv.houseBuilt) tryPlaceHouse(p);
  }

  function tryDig(p){
    if (state.sharedInv.shovel<=0){ message("You need a shovel to dig."); return; }
    const k=keyTile(p.x,p.y);
    if (!state.dug.has(k)){ state.dug.add(k); if (Math.random()<0.1){ state.sharedInv.stone++; message("You found +1 stone while digging."); refreshInv(); } if (state.chamber.x===p.x && state.chamber.y===p.y){ message("You uncovered the entrance to an underground chamber."); } }
    else message("Already dug here.");
  }

  function tryPlaceHouse(p){
    const k=keyTile(p.x,p.y);
    if (state.trees.has(k) || state.rocks.has(k)){ message("Clear the tile first."); return; }
    state.sharedInv.houseFrame--; state.sharedInv.houseBuilt=1; message("You built a home. THE END ♥"); state.won=true;
  }

  function startMinigame(t){ if(state.minigame) return; if(t===0) startSimon(); if(t===1) startClicker(); if(t===2) startRiddle(); }
  function startSimon(){ const seq=[], colors=['#3b82f6','#16a34a','#f59e0b','#ef4444']; const add=()=>seq.push((Math.random()*4)|0); add(); add(); let idx=0,showing=true,showTick=0; const sim={type:'simon',seq,colors,idx,showing,showTick,input:[],update(dt){showTick+=dt;if(showing&&showTick>700){this.idx++;showTick=0;if(this.idx>=seq.length){this.showing=false;this.idx=0;}}},click(mx,my){if(this.showing)return;const w=200,h=200,x=(W-w)/2,y=(H-h)/2;const quad=(mx<x+w/2?(my<y+h/2?0:2):(my<y+h/2?1:3));this.input.push(quad);const ok=this.input[this.input.length-1]===seq[this.input.length-1];if(!ok)endMinigame(False,"Simon failed. Try another shrine later.");else if(this.input.length===seq.length)endMinigame(true,"Simon cleared! You gained a sigil.");},draw(){ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(0,0,W,H);const w=200,h=200,x=(W-w)/2,y=(H-h)/2;const rects=[[x,y],[x+w/2,y],[x,y+h/2],[x+w/2,y+h/2]];for(let i=0;i<4;i++){ctx.fillStyle=colors[i];ctx.fillRect(rects[i][0],rects[i][1],w/2,h/2);}if(this.showing){const hi=seq[Math.min(this.idx, seq.length-1)];ctx.fillStyle='rgba(255,255,255,.6)';const rx=rects[hi][0],ry=rects[hi][1];ctx.fillRect(rx,ry,w/2,h/2);}else{drawCenterText("Repeat the sequence by clicking the colored squares.",80);}}}; state.minigame=sim; }
  function startClicker(){ const targets=[],total=5; let captured=0; function spawn(){ targets.push({x:(60+Math.random()*(W-120))|0,y:(60+Math.random()*(H-120))|0,r:18}); } for(let i=0;i<total;i++)spawn(); const t0=performance.now(), lim=10000; state.minigame={type:'clicker',update(){if(performance.now()-t0>lim) endMinigame(false,"You ran out of time.");},click(mx,my){for(let i=0;i<targets.length;i++){const t=targets[i];if(Math.hypot(mx-t.x,my-t.y)<=t.r){targets.splice(i,1);captured++;break;}}if(captured>=total)endMinigame(true,"Great aim! You gained a sigil.");},draw(){ctx.fillStyle='rgba(0,0,0,.7)';ctx.fillRect(0,0,W,H);drawCenterText("Click all the circles in 10 seconds!",80);for(const t of targets){ctx.beginPath();ctx.arc(t.x,t.y,t.r,0,Math.PI*2);ctx.fillStyle='#eab308';ctx.fill();}const left=Math.max(0,((lim-(performance.now()-t0))/1000)|0);drawCenterText(`Targets left: ${total-captured}  |  Time: ${left}s`,120);}}; }
  function startRiddle(){ const answer="FAMILY"; state.minigame={type:'riddle',input:"",key(code){ if(code==='Enter'){ if(this.input.trim().toUpperCase()===answer) endMinigame(true,"Riddle solved! You gained a sigil."); else endMinigame(false,"Wrong answer. (Hint: the people you play with.)"); } else if(code==='Backspace'){ this.input=this.input.slice(0,-1); } else if(code.startsWith('Key')||code.startsWith('Digit')||code==='Space'){ const ch=code==='Space'?' ':code.replace('Key','').replace('Digit',''); this.input+=ch; }},update(){},draw(){ ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(0,0,W,H); drawCenterText("Riddle: What do we protect and play with together?",120); drawCenterText("Type your answer then press Enter.",150); drawCenterText(this.input,190); }}; }

  function endMinigame(success,msg){ if(success){ state.sharedInv.sigils=Math.min(3,state.sharedInv.sigils+1); refreshInv(); } message(msg); state.minigame=null; }

  function message(msg){ state.messages.push({msg,t:performance.now()}); }
  function refreshInv(){ const inv=ui.inventory; inv.innerHTML=''; for(const [k,v] of Object.entries(state.sharedInv)){ const el=document.createElement('div'); el.className='item'; el.textContent=`${k}: ${v}`; inv.appendChild(el); } ui.statMinigames.textContent=`Sigils: ${state.sharedInv.sigils}/3`; }

  canvas.addEventListener('mousedown', e=>{ if(state.minigame && state.minigame.click){ const r=canvas.getBoundingClientRect(); state.minigame.click(e.clientX-r.left, e.clientY-r.top); } });
  window.addEventListener('keydown', e=>{ if(state.minigame && state.minigame.key) state.minigame.key(e.code); });

  function togglePause(){ state.paused=!state.paused; document.getElementById('btnPause').textContent = state.paused ? 'Resume' : 'Pause'; }

  function update(dt){
    if(!state.running || state.paused) return;
    const cycleNow=performance.now();
    const prevPhase=((state.lastCycleMark-state.t0)%DAY_LENGTH_MS)/DAY_LENGTH_MS;
    const curPhase=((cycleNow-state.t0)%DAY_LENGTH_MS)/DAY_LENGTH_MS;
    const justNight=(!(prevPhase>=NIGHT_START && prevPhase<=NIGHT_END)) && (curPhase>=NIGHT_START && curPhase<=NIGHT_END);
    const justDay=(prevPhase<=NIGHT_END && curPhase>NIGHT_END);
    if (justNight){ state.nightsElapsed++; if (state.nightsElapsed>MAX_NIGHTS) gameOver("You ran out of time. 99 nights have passed."); }
    if (justDay){ state.dayCount++; }
    state.lastCycleMark=cycleNow;

    const p1=state.player1, p2=state.player2;
    if (keys['KeyW']) p1.y=Math.max(0,Math.min(WORLD-1,p1.y-1));
    if (keys['KeyS']) p1.y=Math.max(0,Math.min(WORLD-1,p1.y+1));
    if (keys['KeyA']) p1.x=Math.max(0,Math.min(WORLD-1,p1.x-1));
    if (keys['KeyD']) p1.x=Math.max(0,Math.min(WORLD-1,p1.x+1));
    if (keys['ArrowUp']) p2.y=Math.max(0,Math.min(WORLD-1,p2.y-1));
    if (keys['ArrowDown']) p2.y=Math.max(0,Math.min(WORLD-1,p2.y+1));
    if (keys['ArrowLeft']) p2.x=Math.max(0,Math.min(WORLD-1,p2.x-1));
    if (keys['ArrowRight']) p2.x=Math.max(0,Math.min(WORLD-1,p2.x+1));

    if (keys['KeyE']){ tryInteract(p1); keys['KeyE']=false; }
    if (keys['ShiftRight']){ tryInteract(p2); keys['ShiftRight']=false; }
    if (keys['KeyF']){ tryDig(p1); keys['KeyF']=false; }
    if (keys['ControlRight']){ tryDig(p2); keys['ControlRight']=false; }

    updateEnemies();

    if (isNight()){
      const all=[p1,p2];
      for (const pl of all){
        for (const e of state.enemies){
          if (pl && Math.abs(pl.x-e.x)<=0 && Math.abs(pl.y-e.y)<=0){ gameOver("You were slain by a creature in the night."); break; }
        }
      }
    }

    ui.statDay.textContent=`Day ${state.dayCount}`;
    ui.statTime.textContent=phaseLabel();
    ui.statNightsLeft.textContent=`Nights left: ${Math.max(0,MAX_NIGHTS-state.nightsElapsed)}`;
  }

  function gameOver(text){
    state.lost=true; state.running=false;
    ui.overlay.classList.remove('hidden');
    ui.overlayText.innerHTML = `<div style="font-size:64px;color:#ef4444;font-weight:800;letter-spacing:3px;">GAME OVER</div><p>${text}</p>`;
  }

  function draw(){
    const follow = state.viewTarget===1?state.player1:state.player2;
    const camX=Math.max(0,Math.min(60-COLS, follow.x-Math.floor(COLS/2)));
    const camY=Math.max(0,Math.min(60-ROWS, follow.y-Math.floor(ROWS/2)));
    const night=isNight();
    ctx.fillStyle=night?'#02030a':'#0b3315'; ctx.fillRect(0,0,W,H);

    for(let gx=0; gx<COLS; gx++){
      for(let gy=0; gy<ROWS; gy++){
        const wx=camX+gx, wy=camY+gy, x=gx*TILE, y=gy*TILE;
        ctx.fillStyle = night ? '#0a1f0e' : '#184b22'; ctx.fillRect(x,y,TILE,TILE);
        if (state.dug.has(`${wx},${wy}`)){ ctx.fillStyle='#3a2f25'; ctx.fillRect(x,y,TILE,TILE); }
        if (state.trees.has(`${wx},${wy}`)){ ctx.fillStyle='#14532d'; ctx.fillRect(x+4,y+4,TILE-8,TILE-8); }
        if (state.rocks.has(`${wx},${wy}`)){ ctx.fillStyle='#64748b'; ctx.fillRect(x+6,y+6,TILE-12,TILE-12); }
        const shrine=state.shrines.find(s=>s.x===wx && s.y===wy);
        if (shrine){ ctx.fillStyle='#fbbf24'; ctx.fillRect(x+3,y+3,TILE-6,TILE-6); ctx.fillStyle='#111827'; ctx.fillText('★', x+7, y+18); }
        if (state.chamber.x===wx && state.chamber.y===wy){ ctx.strokeStyle='#a78bfa'; ctx.strokeRect(x+2,y+2,TILE-4,TILE-4); ctx.fillStyle='#c4b5fd'; ctx.fillText('⛓', x+6, y+18); }
      }
    }

    for(const e of state.enemies){
      const gx=e.x-camX, gy=e.y-camY;
      if (gx>=0 && gy>=0 && gx<COLS && gy<ROWS){ ctx.fillStyle='#ef4444'; ctx.fillRect(gx*TILE+4, gy*TILE+4, TILE-8, TILE-8); }
    }

    function drawPlayer(p,color){ const gx=p.x-camX, gy=p.y-camY; ctx.fillStyle=color; ctx.fillRect(gx*TILE+3, gy*TILE+3, TILE-6, TILE-6); }
    drawPlayer(state.player1,'#93c5fd'); drawPlayer(state.player2,'#fda4af');

    let y=H-8;
    for(let i=state.messages.length-1;i>=0;i--){
      const m=state.messages[i], age=performance.now()-m.t;
      if (age>5000){ state.messages.splice(i,1); continue; }
      ctx.fillStyle='rgba(0,0,0,.5)'; ctx.fillRect(10,y-18, W-20, 18);
      ctx.fillStyle='#e5e7eb'; ctx.fillText(m.msg, 20, y-4);
      y-=20;
    }

    if (state.won){ ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(0,0,W,H); ctx.fillStyle='#fff7ed'; ctx.font='bold 72px system-ui,Segoe UI,Roboto,Arial'; const m=ctx.measureText('THE END'); ctx.fillText('THE END', (W-m.width)/2, H/2); }
    if (night){ ctx.fillStyle='rgba(0,0,0,.35)'; ctx.fillRect(0,0,W,H); }
  }

  canvas.addEventListener('contextmenu', e => { e.preventDefault(); state.viewTarget = (state.viewTarget===1?2:1); });
  let last=performance.now();
  function loop(ts){ const dt=ts-last; last=ts; if(state.minigame){ if(state.minigame.update) state.minigame.update(dt); draw(); state.minigame.draw(); } else { update(dt); draw(); } refreshInv(); requestAnimationFrame(loop); }

  function drawCenterText(text, y){ ctx.fillStyle='#e5e7eb'; ctx.font='16px system-ui,Segoe UI,Roboto,Arial'; const m=ctx.measureText(text); ctx.fillText(text,(W-m.width)/2,y); }

  newGame(); refreshInv(); requestAnimationFrame(loop);
})();
