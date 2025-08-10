// Family Rescue: 99 Nights - single-file JS (no external deps)
(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const TILE = 24;
  const COLS = Math.floor(W / TILE);
  const ROWS = Math.floor(H / TILE);
  const WORLD = 60; // 60x60 tiles world
  const UNDER = 30; // underground depth max (diggable layers)
  const DAY_LENGTH_MS = 2 * 60 * 1000; // 2 minutes per day
  const NIGHT_START = 0.55; // portion of cycle (0..1) when night starts
  const NIGHT_END = 0.95; // end of night
  const MAX_NIGHTS = 99;
  const rng = (seed => () => (seed = (seed * 1664525 + 1013904223)|0, (seed>>>0)/4294967296))(Math.floor(Math.random()*1e9));

  // Game state
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
    modalHelp: document.getElementById('modalHelp'),
    closeHelp: document.getElementById('closeHelp'),
  };

  function newGame() {
    state = {
      running: true,
      t0: performance.now(),
      dayCount: 1,
      nightsElapsed: 0,
      lastCycleMark: performance.now(),
      worldSeed: Math.floor(Math.random()*1e9),
      player1: {x: Math.floor(rng()*WORLD), y: Math.floor(rng()*WORLD), hp:1, key:'E', dig:'F', inv:{} },
      player2: {x: Math.floor(rng()*WORLD), y: Math.floor(rng()*WORLD), hp:1, key: 'ShiftRight', dig:'ControlRight', inv:{} },
      sharedInv: { wood:0, stone:0, shovel:0, sigils:0, child:0, houseFrame:0, houseBuilt:0 },
      shrines: [],
      trees: new Set(),
      rocks: new Set(),
      dug: new Set(),
      chamber: null,
      enemies: [],
      paused: false,
      viewTarget: 1, // follow player1 by default
      messages: [],
      minigame: null, // if non-null, minigame active
      won: false,
      lost: false,
    };
    placeWorld();
    message("Find shrines (★) to earn 3 sigils, craft a shovel, then dig to find the chamber and rescue the child.");
  }

  function keyTile(x, y) { return `${x},${y}`; }

  function placeWorld() {
    // Trees and rocks
    const density = 0.10;
    for (let x=0; x<WORLD; x++) {
      for (let y=0; y<WORLD; y++) {
        const r = rng();
        if (r < density*0.7) state.trees.add(keyTile(x,y));
        else if (r < density) state.rocks.add(keyTile(x,y));
      }
    }
    // Clear spawn tiles
    state.trees.delete(keyTile(state.player1.x, state.player1.y));
    state.rocks.delete(keyTile(state.player1.x, state.player1.y));

    // Shrines (3)
    const shrinePositions = [];
    for (let i=0;i<3;i++){
      let sx, sy;
      do {
        sx = Math.floor(rng()*WORLD);
        sy = Math.floor(rng()*WORLD);
      } while (state.trees.has(keyTile(sx,sy)) || state.rocks.has(keyTile(sx,sy)));
      shrinePositions.push({x:sx,y:sy,type:i});
    }
    state.shrines = shrinePositions;

    // Chamber underground somewhere not too near
    let cx, cy;
    do {
      cx = Math.floor(rng()*WORLD);
      cy = Math.floor(rng()*WORLD);
    } while (Math.hypot(cx-state.player1.x, cy-state.player1.y) < 10);
    state.chamber = {x:cx, y:cy, requiredSigils:3, unlocked:false};
  }

  function isNight() {
    const phase = ((performance.now() - state.t0) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
    return phase >= NIGHT_START && phase <= NIGHT_END;
  }
  function phaseLabel() {
    const phase = ((performance.now() - state.t0) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
    if (phase < 0.2) return "Dawn";
    if (phase < NIGHT_START) return "Day";
    if (phase <= NIGHT_END) return "Night";
    return "Dawn";
  }

  // Enemies spawn at night
  function updateEnemies() {
    if (isNight()) {
      if (state.enemies.length < 8 && rng() < 0.02) {
        const ex = Math.floor(rng()*WORLD);
        const ey = Math.floor(rng()*WORLD);
        state.enemies.push({x:ex,y:ey, vx:0, vy:0});
      }
      for (const e of state.enemies) {
        // simple wander towards nearest player
        const target = (Math.hypot(e.x - state.player1.x, e.y - state.player1.y) < Math.hypot(e.x - state.player2.x, e.y - state.player2.y)) ? state.player1 : state.player2;
        const dx = Math.sign(target.x - e.x);
        const dy = Math.sign(target.y - e.y);
        if (rng() < 0.7) e.x += dx;
        if (rng() < 0.7) e.y += dy;
        e.x = clamp(e.x, 0, WORLD-1);
        e.y = clamp(e.y, 0, WORLD-1);
      }
    } else {
      // despawn slowly
      if (state.enemies.length && rng() < 0.04) state.enemies.pop();
    }
  }

  function clamp(v,min,max){return v<min?min:v>max?max:v;}

  const keys = {};
  window.addEventListener('keydown', e => { keys[e.code] = true; if (e.code==='KeyP') togglePause(); });
  window.addEventListener('keyup', e => keys[e.code] = false);

  function tryInteract(p) {
    // Chop tree or mine rock on current tile
    const k = keyTile(p.x, p.y);
    if (state.trees.has(k)) { state.trees.delete(k); state.sharedInv.wood += 1; message("+1 wood"); refreshInv(); return; }
    if (state.rocks.has(k)) { state.rocks.delete(k); state.sharedInv.stone += 1; message("+1 stone"); refreshInv(); return; }
    // Shrine?
    const shrine = state.shrines.find(s => s.x===p.x && s.y===p.y);
    if (shrine) {
      if (state.sharedInv.sigils >= 3) { message("You already have all sigils."); return; }
      startMinigame(shrine.type);
      return;
    }
    // Chamber?
    if (state.chamber.x===p.x && state.chamber.y===p.y) {
      if (!state.chamber.unlocked) {
        if (state.sharedInv.sigils >= state.chamber.requiredSigils) {
          if (state.sharedInv.child===0) {
            state.chamber.unlocked = true;
            state.sharedInv.child = 1;
            message("You rescued the child! Find a spot to build your house.");
          }
        } else {
          message("A sealed chamber. You need 3 sigils to unlock.");
        }
      }
      return;
    }
  }

  function tryDig(p) {
    if (state.sharedInv.shovel <= 0) { message("You need a shovel to dig."); return; }
    const k = keyTile(p.x, p.y);
    if (!state.dug.has(k)) {
      state.dug.add(k);
      // 10% chance to find extra stone
      if (rng() < 0.1) { state.sharedInv.stone += 1; message("You found +1 stone while digging."); refreshInv(); }
      // Reveal chamber if digging correct tile (flavor)
      if (state.chamber.x===p.x && state.chamber.y===p.y) {
        message("You uncovered the entrance to an underground chamber.");
      }
    } else {
      message("Already dug here.");
    }
  }

  function tryPlaceHouse(p) {
    if (state.sharedInv.child===0) { message("Rescue the child first."); return; }
    if (state.sharedInv.houseFrame<=0) { message("Craft a House Frame first."); return; }
    // place house at current tile if ground is clear
    const k = keyTile(p.x,p.y);
    if (state.trees.has(k) || state.rocks.has(k)) { message("Clear the tile first."); return; }
    state.sharedInv.houseFrame -= 1;
    state.sharedInv.houseBuilt = 1;
    message("You built a home. THE END ♥");
    state.won = true;
  }

  // Minigames (3 types): Simon, Quick Click, Riddle
  function startMinigame(type) {
    if (state.minigame) return;
    if (type===0) startSimon();
    if (type===1) startClicker();
    if (type===2) startRiddle();
  }

  function startSimon() {
    const seq = [];
    const colors = ['#3b82f6','#16a34a','#f59e0b','#ef4444'];
    const add = () => seq.push(Math.floor(rng()*4));
    add(); add();
    let idx = 0;
    let showing = true;
    let showTick = 0;
    const sim = {
      type:'simon', seq, colors, idx, showing, showTick, input:[],
      update(dt){ showTick += dt; if (showing && showTick > 700) { this.idx++; showTick=0; if (this.idx>=seq.length){ this.showing=false; this.idx=0; } } },
      click(mx,my){ if (this.showing) return;
        const w=200,h=200,x=(W- w)/2,y=(H-h)/2;
        const quad = (mx<x+w/2? (my<y+h/2?0:2) : (my<y+h/2?1:3));
        this.input.push(quad);
        const ok = this.input[this.input.length-1]===seq[this.input.length-1];
        if (!ok){ endMinigame(false,"Simon failed. Try another shrine later."); }
        else if (this.input.length===seq.length){ endMinigame(true,"Simon cleared! You gained a sigil."); }
      },
      draw(){
        ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(0,0,W,H);
        const w=200,h=200,x=(W- w)/2,y=(H-h)/2;
        const rects=[ [x,y],[x+w/2,y],[x,y+h/2],[x+w/2,y+h/2] ];
        for(let i=0;i<4;i++){ ctx.fillStyle=colors[i]; ctx.fillRect(rects[i][0],rects[i][1],w/2,h/2); }
        if (this.showing){
          const hi = seq[Math.min(this.idx, seq.length-1)];
          ctx.fillStyle='rgba(255,255,255,.6)';
          const rx = rects[hi][0], ry = rects[hi][1];
          ctx.fillRect(rx, ry, w/2,h/2);
        } else {
          drawCenterText("Repeat the sequence by clicking the colored squares.", y-20);
        }
      }
    };
    state.minigame = sim;
  }

  function startClicker() {
    const targets = [];
    const total = 5;
    let captured = 0;
    function spawn(){
      targets.push({x:Math.floor(60+Math.random()*(W-120)), y:Math.floor(60+Math.random()*(H-120)), r:18});
    }
    for(let i=0;i<total;i++) spawn();
    const t0 = performance.now();
    const lim = 10000; // 10s
    const game = {
      type:'clicker',
      update(){ if (performance.now()-t0>lim){ endMinigame(false,"You ran out of time."); } },
      click(mx,my){
        for(let i=0;i<targets.length;i++){
          const t=targets[i];
          if(Math.hypot(mx-t.x,my-t.y)<=t.r){ targets.splice(i,1); captured++; break; }
        }
        if (captured>=total){ endMinigame(true,"Great aim! You gained a sigil."); }
      },
      draw(){
        ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(0,0,W,H);
        drawCenterText("Click all the circles in 10 seconds!", 80);
        for(const t of targets){ ctx.beginPath(); ctx.arc(t.x,t.y,t.r,0,Math.PI*2); ctx.fillStyle='#eab308'; ctx.fill(); }
        const left = Math.max(0, ((lim-(performance.now()-t0))/1000)|0);
        drawCenterText(`Targets left: ${total-captured}  |  Time: ${left}s`, 120);
      }
    };
    state.minigame = game;
  }

  function startRiddle() {
    const answer = "FAMILY";
    const game = {
      type:'riddle',
      input:"",
      update(){ },
      key(code){
        if (code==='Enter'){
          if (this.input.trim().toUpperCase()===answer) endMinigame(true,"Riddle solved! You gained a sigil.");
          else endMinigame(false,"Wrong answer. (Hint: the people you play with.)");
        } else if (code==='Backspace'){ this.input = this.input.slice(0,-1); }
        else if (code.startsWith('Key') || code.startsWith('Digit') || code==='Space'){ 
          const ch = code==='Space' ? ' ' : code.replace('Key','').replace('Digit','');
          this.input += ch;
        }
      },
      draw(){
        ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(0,0,W,H);
        drawCenterText("Riddle: What do we protect and play with together?", 120);
        drawCenterText("Type your answer then press Enter.", 150);
        drawCenterText(this.input, 190);
      }
    };
    state.minigame = game;
  }

  function endMinigame(success, msg){
    if (success) { state.sharedInv.sigils = Math.min(3, state.sharedInv.sigils+1); refreshInv(); }
    message(msg);
    state.minigame = null;
  }

  // UI helpers
  function message(msg){
    state.messages.push({msg, t: performance.now()});
  }
  function refreshInv(){
    ui.inventory.innerHTML = '';
    for (const [k,v] of Object.entries(state.sharedInv)){
      const el = document.createElement('div'); el.className='item'; el.textContent=`${k}: ${v}`; ui.inventory.appendChild(el);
    }
    ui.statMinigames.textContent = `Sigils: ${state.sharedInv.sigils}/3`;
  }

  ui.crafting.addEventListener('click', (e) => {
    if (!(e.target instanceof HTMLButtonElement)) return;
    const which = e.target.dataset.item;
    if (which==='shovel'){
      if (state.sharedInv.wood>=3 && state.sharedInv.stone>=2){
        state.sharedInv.wood -= 3; state.sharedInv.stone -= 2; state.sharedInv.shovel += 1; message("Crafted a shovel."); refreshInv();
      } else message("Need wood 3 + stone 2.");
    }
    if (which==='house'){
      if (state.sharedInv.wood>=20 && state.sharedInv.stone>=10){
        state.sharedInv.wood -= 20; state.sharedInv.stone -= 10; state.sharedInv.houseFrame += 1; message("Crafted a House Frame."); refreshInv();
      } else message("Need wood 20 + stone 10.");
    }
  });

  // Input for two players + minigames
  canvas.addEventListener('mousedown', (e)=>{
    if (state.minigame && state.minigame.click) {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      state.minigame.click(mx,my);
    }
  });
  window.addEventListener('keydown', (e)=>{
    if (state.minigame && state.minigame.key) state.minigame.key(e.code);
  });

  // Overlay & help
  ui.btns.help.onclick = ()=>ui.modalHelp.classList.remove('hidden');
  ui.closeHelp.onclick = ()=>ui.modalHelp.classList.add('hidden');
  ui.btns.pause.onclick = togglePause;
  ui.btns.restart.onclick = ()=>{ newGame(); refreshInv(); };
  ui.overlayBtn.onclick = ()=>ui.overlay.classList.add('hidden');
  document.getElementById('btnHelp').onclick = ()=>ui.modalHelp.classList.remove('hidden');

  function togglePause(){
    state.paused = !state.paused;
    ui.btns.pause.textContent = state.paused ? 'Resume' : 'Pause';
  }

  function update(dt) {
    if (!state.running || state.paused) return;
    // time/day tracking
    const cycleNow = performance.now();
    const prevPhase = ((state.lastCycleMark - state.t0) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
    const curPhase = ((cycleNow - state.t0) % DAY_LENGTH_MS) / DAY_LENGTH_MS;
    const justBecameNight = (! (prevPhase>=NIGHT_START && prevPhase<=NIGHT_END)) && (curPhase>=NIGHT_START && curPhase<=NIGHT_END);
    const justBecameDay = (prevPhase<=NIGHT_END && curPhase>NIGHT_END);
    if (justBecameNight) { state.nightsElapsed++; if (state.nightsElapsed>MAX_NIGHTS){ gameOver("You ran out of time. 99 nights have passed."); } }
    if (justBecameDay) { state.dayCount++; }
    state.lastCycleMark = cycleNow;

    // move players
    const p1 = state.player1, p2 = state.player2;
    const spd = 8*dt/16;
    if (keys['KeyW']) p1.y = clamp(p1.y-1,0,WORLD-1);
    if (keys['KeyS']) p1.y = clamp(p1.y+1,0,WORLD-1);
    if (keys['KeyA']) p1.x = clamp(p1.x-1,0,WORLD-1);
    if (keys['KeyD']) p1.x = clamp(p1.x+1,0,WORLD-1);
    if (keys['ArrowUp']) p2.y = clamp(p2.y-1,0,WORLD-1);
    if (keys['ArrowDown']) p2.y = clamp(p2.y+1,0,WORLD-1);
    if (keys['ArrowLeft']) p2.x = clamp(p2.x-1,0,WORLD-1);
    if (keys['ArrowRight']) p2.x = clamp(p2.x+1,0,WORLD-1);

    // interactions
    if (keys[p1.key]) { tryInteract(p1); keys[p1.key]=false; }
    if (keys[p2.key]) { tryInteract(p2); keys[p2.key]=false; }
    if (keys['KeyF']) { tryDig(p1); keys['KeyF']=false; }
    if (keys['ControlRight']) { tryDig(p2); keys['ControlRight']=false; }
    if (keys['KeyC']) { /* craft panel is always visible */ }

    // place house with 'E' while carrying child and frame
    // We'll use interact on empty tile to place house if have child+frame
    // (Handled by pressing interact on empty ground)
    // Implement here:
    const tryPlace = () => {
      if (state.sharedInv.child && state.sharedInv.houseFrame && !state.sharedInv.houseBuilt){
        tryPlaceHouse(p1);
      }
    };

    // enemies
    updateEnemies();
    // death check
    if (isNight()) {
      const allPlayers = [p1,p2];
      for (const pl of allPlayers){
        for (const e of state.enemies){
          if (pl && Math.abs(pl.x - e.x)<=0 && Math.abs(pl.y - e.y)<=0){
            gameOver("You were slain by a creature in the night.");
            break;
          }
        }
      }
    }

    // UI updates
    ui.statDay.textContent = `Day ${state.dayCount}`;
    ui.statTime.textContent = phaseLabel();
    ui.statNightsLeft.textContent = `Nights left: ${Math.max(0, MAX_NIGHTS - state.nightsElapsed)}`;
  }

  function gameOver(text){
    state.lost = true; state.running=false;
    ui.overlay.classList.remove('hidden');
    ui.overlayText.innerHTML = `<div style="font-size:64px;color:#ef4444;font-weight:800;letter-spacing:3px;">GAME OVER</div><p>${text}</p>`;
  }

  function draw() {
    // camera center on viewTarget player
    const follow = state.viewTarget===1? state.player1 : state.player2;
    const camX = clamp(follow.x - Math.floor(COLS/2), 0, Math.max(0, WORLD-COLS));
    const camY = clamp(follow.y - Math.floor(ROWS/2), 0, Math.max(0, WORLD-ROWS));

    // background with day/night tint
    const night = isNight();
    ctx.fillStyle = night ? '#02030a' : '#0b3315';
    ctx.fillRect(0,0,W,H);

    // draw ground grid
    for (let gx=0; gx<COLS; gx++){
      for (let gy=0; gy<ROWS; gy++){
        const wx = camX + gx, wy = camY + gy;
        const x = gx*TILE, y = gy*TILE;
        // dug tiles
        if (state.dug.has(keyTile(wx,wy))){
          ctx.fillStyle = '#3a2f25';
          ctx.fillRect(x,y,TILE,TILE);
        } else {
          ctx.fillStyle = night ? '#0a1f0e' : '#184b22';
          ctx.fillRect(x,y,TILE,TILE);
        }
        // trees
        if (state.trees.has(keyTile(wx,wy))){
          ctx.fillStyle = '#14532d'; ctx.fillRect(x+4,y+4,TILE-8,TILE-8);
        }
        // rocks
        if (state.rocks.has(keyTile(wx,wy))){
          ctx.fillStyle = '#64748b'; ctx.fillRect(x+6,y+6,TILE-12,TILE-12);
        }
        // shrines
        const shrine = state.shrines.find(s => s.x===wx && s.y===wy);
        if (shrine){
          ctx.fillStyle = '#fbbf24'; ctx.fillRect(x+3,y+3,TILE-6,TILE-6);
          ctx.fillStyle = '#111827'; ctx.fillText('★', x+7, y+18);
        }
        // chamber
        if (state.chamber.x===wx && state.chamber.y===wy){
          ctx.strokeStyle = '#a78bfa';
          ctx.strokeRect(x+2,y+2,TILE-4,TILE-4);
          ctx.fillStyle = '#c4b5fd';
          ctx.fillText('⛓', x+6, y+18);
        }
      }
    }

    // draw enemies
    for (const e of state.enemies){
      const gx = e.x - camX, gy = e.y - camY;
      if (gx>=0 && gy>=0 && gx<COLS && gy<ROWS){
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(gx*TILE+4, gy*TILE+4, TILE-8, TILE-8);
      }
    }

    // draw players
    function drawPlayer(p, color){
      const gx = p.x - camX, gy = p.y - camY;
      ctx.fillStyle = color;
      ctx.fillRect(gx*TILE+3, gy*TILE+3, TILE-6, TILE-6);
    }
    drawPlayer(state.player1, '#93c5fd');
    drawPlayer(state.player2, '#fda4af');

    // message toasts
    let y=H-8;
    for (let i=state.messages.length-1; i>=0; i--){
      const m=state.messages[i]; const age = performance.now()-m.t;
      if (age>5000){ state.messages.splice(i,1); continue; }
      ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(10,y-18, W-20, 18);
      ctx.fillStyle = '#e5e7eb'; ctx.fillText(m.msg, 20, y-4);
      y -= 20;
    }

    // win overlay
    if (state.won){
      ctx.fillStyle='rgba(0,0,0,.7)'; ctx.fillRect(0,0,W,H);
      drawBigCenter("THE END", night? '#fef3c7':'#fff7ed');
    }

    // night vignette
    if (night){
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0,0,W,H);
    }
  }

  function drawCenterText(text, y) {
    ctx.fillStyle = '#e5e7eb';
    ctx.font = '16px system-ui,Segoe UI,Roboto,Arial';
    const m = ctx.measureText(text);
    ctx.fillText(text, (W - m.width)/2, y);
  }
  function drawBigCenter(text, color) {
    ctx.fillStyle = color;
    ctx.font = 'bold 72px system-ui,Segoe UI,Roboto,Arial';
    const m = ctx.measureText(text);
    ctx.fillText(text, (W - m.width)/2, H/2);
  }

  let last = performance.now();
  function loop(ts){
    const dt = ts - last; last = ts;
    if (state.minigame){
      if (state.minigame.update) state.minigame.update(dt);
      // draw world darkened + minigame
      draw();
      state.minigame.draw();
    } else {
      update(dt);
      draw();
    }
    // update UI text
    refreshInv();
    requestAnimationFrame(loop);
  }

  // mouse to switch view target
  canvas.addEventListener('contextmenu', e => { e.preventDefault(); state.viewTarget = (state.viewTarget===1?2:1); });

  // Overlay helpers for explicit Game Over button scenarios
  function showOverlay(text){
    ui.overlayText.innerHTML = text;
    ui.overlay.classList.remove('hidden');
  }

  // Start
  newGame();
  refreshInv();
  requestAnimationFrame(loop);
})();
