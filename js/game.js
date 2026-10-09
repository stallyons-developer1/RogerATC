/* ============================================================
   RogerATC — ATC MAYDAY  |  Core game engine (HTML5 Canvas)
   Flappy-style plane through a scrolling sunset obstacle course.
   Vector-rendered (per spec: "can be done ... even vector based.
   The Obstacle Course is most important.")
   ============================================================ */

const Game = (() => {
  let canvas, ctx, W = 0, H = 0, dpr = 1;
  let state = 'idle';                 // idle | running | paused | over
  let raf = 0, last = 0;
  let cb = {};                        // callbacks from UI
  let bgImg = null, bgReady = false;  // background photo
  const breezeMode = !!window.BREEZE; // Breeze variant: blue theme + Breeze plane
  let planeImg = null, planeReady = false, planeAspect = 3.4;
  let palmImgs = [], palmReady = false; // real palm silhouette sprites
  let crowImg = null, crowReady = false; // animated crow flap sheet (10 frames)
  const CROW_FRAMES = 10;
  let eagleImg = null, eagleReady = false; // animated eagle flap sheet (12 frames) — big birds
  const EAGLE_FRAMES = 12;
  let smokeImg = null, smokeReady = false; // continuous smoke plume (50-frame GIF → grid sheet) — toxic smoke
  const SMOKE_FRAMES = 50, SMOKE_COLS = 10, SMOKE_ROWS = 5;
  const SMOKE_EMIT = 0.44;   // emission point x within each cell (base sits here → align to chimney)
  let chimneyImg = null, chimneyReady = false; // realistic chimney image (smoke stacks)
  const CHIMNEY_ASPECT = 0.241;   // img w/h
  let mtnImg = null, mtnReady = false, mtnAspect = 0.924; // realistic rock peak
  let windT = 0;                      // wind animation clock

  // shared sunset-silhouette palette
  const SIL = '#120a1c';              // foreground silhouette fill
  const RIM = 'rgba(255,150,80,0.55)';// warm sun rim-light
  const WIN = 'rgba(255,196,96,0.95)';// warm window / light glow

  // world layout
  let ceilingY = 0, floorY = 0, groundH = 0;

  // player + world objects
  let plane, entities, particles, popups;
  let farMtns, palms, bgClouds;       // parallax decoration
  let scroll, scrollSpeed, bgScroll;

  // run stats
  let score, birdHits, duration, elapsed, timeLeft, waveCount;
  let speedMph, speedTick, chatterTick, spawnGap, sunGlow;
  let floorCool, crashing, crashTime;
  let callsign = '';

  const rand = (a, b) => a + Math.random() * (b - a);         // cosmetic (particles, decor, chatter)
  const randi = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

  // ---- seeded RNG — used ONLY for terrain so a shared seed = identical course (multiplayer) ----
  let _seed = 1, currentSeed = 1;
  function seedRng(s) { _seed = (s >>> 0) || 1; }
  function _next() {                                           // mulberry32
    _seed = (_seed + 0x6D2B79F5) | 0;
    let t = Math.imul(_seed ^ (_seed >>> 15), 1 | _seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const srand = (a, b) => a + _next() * (b - a);
  const srandi = (a, b) => Math.floor(srand(a, b + 1));
  const spick = (arr) => arr[Math.floor(_next() * arr.length)];

  /* ---------------------------------------------------------- setup */
  function init(cvs) {
    canvas = cvs;
    ctx = canvas.getContext('2d');
    if (new URLSearchParams(location.search).get('nodie')) window.NODIE = true;   // inspection mode via ?nodie=1
    bgImg = new Image();
    bgImg.onload = () => { bgReady = true; if (state === 'idle') drawIdleBackdrop(); };
    bgImg.src = breezeMode ? 'assets/breeze/bg_breeze.webp' : 'assets/bg_sunset.webp';
    if (breezeMode) {                                   // real Breeze plane sprite
      planeImg = new Image();
      planeImg.onload = () => { planeReady = true; planeAspect = planeImg.width / planeImg.height; };
      planeImg.src = 'assets/breeze/plane_breeze.webp';
    }
    // real palm silhouettes (wind-animated)
    ['assets/palm.webp', 'assets/palm2.webp'].forEach((src, i) => {
      const img = new Image();
      img.onload = () => { palmImgs[i] = img; if (palmImgs.filter(Boolean).length) palmReady = true; };
      img.src = src;
    });
    // realistic mountain peak
    mtnImg = new Image();
    mtnImg.onload = () => { mtnReady = true; mtnAspect = mtnImg.width / mtnImg.height; };
    mtnImg.src = 'assets/mountain.webp';
    // animated crow sprite sheet (10-frame flap cycle)
    crowImg = new Image();
    crowImg.onload = () => { crowReady = true; };
    crowImg.src = 'assets/birds/crow_sheet.webp';
    // animated eagle sprite sheet (12-frame flap) — used for the big "instant-die" birds
    eagleImg = new Image();
    eagleImg.onload = () => { eagleReady = true; };
    eagleImg.src = 'assets/birds/eagle_sheet.webp';
    // billowing smoke plume sheet (6-frame churn) — toxic smoke stacks
    smokeImg = new Image();
    smokeImg.onload = () => { smokeReady = true; };
    smokeImg.src = 'assets/smoke_sheet.webp';
    // realistic chimney image for smoke stacks
    chimneyImg = new Image();
    chimneyImg.onload = () => { chimneyReady = true; };
    chimneyImg.src = 'assets/chimney.webp';
    window.addEventListener('resize', resize);
    resize();
  }

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || window.innerWidth;
    const cssH = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = cssW; H = cssH;
    groundH = clamp(H * 0.13, 64, 130);
    floorY = H - groundH;
    ceilingY = H * 0.085;
    if (plane) plane.x = W * 0.28;
    if (state === 'idle') drawIdleBackdrop();
  }

  /* ---------------------------------------------------------- start */
  function start(opts) {
    duration = opts.duration;
    callsign = opts.callsign || '';
    cb = opts.callbacks || {};
    currentSeed = opts.seed || (Math.floor(Math.random() * 1e9) + 1);
    seedRng(currentSeed);                                      // same seed => same terrain

    plane = { x: W * 0.28, y: H * 0.45, vy: 0, angle: 0, size: 32, dead: false };
    entities = [];
    particles = [];
    popups = [];
    buildDecor();

    scroll = 0; bgScroll = 0;
    scrollSpeed = 210;
    score = 0; birdHits = 0; elapsed = 0; timeLeft = duration; waveCount = 0;
    speedMph = DATA.speed.min; speedTick = 0; chatterTick = 1.2;
    spawnGap = 1.0; sunGlow = 0;
    floorCool = 0; crashing = false; crashTime = 0;

    state = 'running';
    last = performance.now();
    if (cb.onScore) cb.onScore(0, 'init');
    if (cb.onSpeed) cb.onSpeed(speedMph);
    // opening radio call that references the call sign
    if (cb.onChatter) cb.onChatter(DATA.takeoffLine(callsign || 'Unknown'), true);

    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(loop);
  }

  function pause()  { if (state === 'running') { state = 'paused'; cancelAnimationFrame(raf); } }
  function resume() { if (state === 'paused') { state = 'running'; last = performance.now(); raf = requestAnimationFrame(loop); } }
  function stop()   { state = 'idle'; cancelAnimationFrame(raf); drawIdleBackdrop(); }

  function lift() {
    if (state !== 'running' || crashing) return;
    plane.vy = DATA.physics.lift;
    plane.angle = -0.45;
    Audio.play('wind');
    // little wind trail
    for (let i = 0; i < 4; i++)
      particles.push(mkParticle(plane.x - 18, plane.y + rand(-6, 6), rand(-120, -40), rand(-30, 30), rand(0.2, 0.4), 'rgba(255,255,255,0.5)', rand(2, 4)));
  }

  /* ---------------------------------------------------------- decor */
  function buildDecor() {
    farMtns = [];                              // background photo provides the horizon now
    palms = [];
    let x = rand(40, 200);
    while (x < W + 260) { palms.push(mkPalm(x)); x += rand(260, 460); }
    bgClouds = [];
    for (let i = 0; i < 3; i++) bgClouds.push({ x: rand(0, W), y: rand(ceilingY + 20, H * 0.32), s: rand(0.7, 1.3), v: rand(5, 14) });
  }

  function mkPalm(x) {
    const h = rand(H * 0.24, H * 0.46);
    return { x, h, img: randi(0, 1), phase: rand(0, 6.28), sway: rand(0.05, 0.09), flut: rand(0.012, 0.022) };
  }

  /* ---------------------------------------------------------- loop */
  function loop(ts) {
    if (state !== 'running') return;
    let dt = (ts - last) / 1000;
    last = ts;
    if (dt > 0.05) dt = 0.05;            // clamp big frame gaps
    update(dt);
    render();
    raf = requestAnimationFrame(loop);
  }

  /* ---------------------------------------------------------- update */
  function update(dt) {
    // course timer
    if (!crashing && !window.NODIE) {        // NODIE freezes the timer (inspection mode)
      elapsed += dt;
      timeLeft = Math.max(0, duration - elapsed);
      if (timeLeft <= 0) { survive(); return; }
    }

    // difficulty ramps speed slightly over the course
    const prog = elapsed / duration;
    scrollSpeed = 210 + prog * 90;
    scroll += scrollSpeed * dt;
    bgScroll += scrollSpeed * dt;

    // ---- plane physics (Flappy style) ----
    const P = DATA.physics;
    if (crashing) {
      plane.vy += P.gravity * 1.3 * dt;
      plane.angle += 3 * dt;
      plane.x -= scrollSpeed * dt * 0.4;
      crashTime += dt;
      emitSmoke(plane.x, plane.y);
      if (crashTime > 1.3) { finish('over'); return; }
    } else {
      plane.vy += P.gravity * dt;
      plane.vy = clamp(plane.vy, P.maxRise, P.maxFall);
      plane.y += plane.vy * dt;
      // ease nose angle toward velocity direction
      const target = clamp(plane.vy / 700, -0.5, 0.7);
      plane.angle += (target - plane.angle) * clamp(dt * 8, 0, 1);

      // ceiling = crash (40k ft line)
      if (plane.y - plane.size * 0.4 <= ceilingY) { crash('ceiling'); }
      // floor = -50 pts penalty + bounce (not death)
      if (plane.y + plane.size * 0.4 >= floorY) {
        plane.y = floorY - plane.size * 0.4;
        plane.vy = -260;
        if (floorCool <= 0) { addScore(DATA.score.floorHit, plane.x, plane.y, 'bad'); Audio.play('poof'); floorCool = 0.8; }
      }
    }
    if (floorCool > 0) floorCool -= dt;

    // ---- spawning ----
    if (!crashing) {
      spawnGap -= dt;
      if (spawnGap <= 0) {
        waveCount++;
        const sprog = Math.min(1, waveCount / 80);            // deterministic difficulty (not time-based)
        spawnWave(sprog);
        spawnGap = srand(0.75, 1.35) * (1 - sprog * 0.25);
      }
    }

    // ---- entities ----
    for (const e of entities) {
      e.x -= scrollSpeed * dt * (e.par || 1);
      if (e.update) e.update(e, dt);
    }
    entities = entities.filter((e) => e.x + (e.w || e.r * 2 || 60) > -80 && !e.dead);

    if (!crashing) checkCollisions();

    // ---- decoration motion (parallax + wind) ----
    windT += dt;
    for (const p of palms) { p.x -= scrollSpeed * dt * 0.55; }
    recycle(palms, (p) => p.x < -120, () => mkPalm(Math.max(...palms.map((p) => p.x)) + rand(260, 460)));
    for (const c of bgClouds) { c.x -= (scrollSpeed * 0.25 + c.v) * dt; if (c.x < -120) { c.x = W + rand(20, 120); c.y = rand(ceilingY + 20, H * 0.45); } }

    // ---- particles + popups ----
    for (const pt of particles) { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 220 * dt; pt.life -= dt; }
    particles = particles.filter((p) => p.life > 0);
    for (const u of popups) { u.y -= 34 * dt; u.life -= dt; }
    popups = popups.filter((u) => u.life > 0);

    // ---- speedometer fluctuation (499–533) ----
    speedTick -= dt;
    if (speedTick <= 0) {
      speedTick = rand(0.35, 0.7);
      speedMph = Math.round(clamp(speedMph + rand(-12, 12), DATA.speed.min, DATA.speed.max));
      if (cb.onSpeed) cb.onSpeed(speedMph);
    }

    // ---- radio chatter ----
    chatterTick -= dt;
    if (chatterTick <= 0 && !crashing) {
      chatterTick = rand(4.5, 7.5);
      if (cb.onChatter) cb.onChatter(pick(DATA.chatter), false);
    }

    sunGlow += dt;
  }

  function recycle(arr, gone, make) { for (let i = 0; i < arr.length; i++) if (gone(arr[i])) arr[i] = make(); }

  /* ---------------------------------------------------------- spawning */
  function spawnWave(prog) {
    // weighted pick — birds are the "nightmare" (everywhere), big rewards rare
    const roll = _next();
    if (roll < 0.34) spawnBirds(prog);
    else if (roll < 0.46) spawnCloud();
    else if (roll < 0.58) spawnBonus(DATA.score.bonusZone, '+100');
    else if (roll < 0.68) spawnMountain();
    else if (roll < 0.77) spawnTower();
    else if (roll < 0.85) spawnSmokeStack();
    else if (roll < 0.90) spawnBonus(spick([DATA.score.peak, DATA.score.valley]), null);
    else if (roll < 0.965) spawnBigBird();
    else spawnJetStream();
  }

  const airY = () => srand(ceilingY + 40, floorY - 50);

  function spawnBirds(prog) {
    const n = srandi(1, 3 + Math.floor(prog * 2));
    const baseY = airY();
    for (let i = 0; i < n; i++) {
      entities.push({
        type: 'bird', x: W + 40 + i * srand(40, 80), y: baseY + srand(-40, 40),
        r: 13, wing: srand(0, 6.28), vyWave: srand(0.6, 1.4), phase: srand(0, 6.28), baseY: baseY + srand(-40, 40),
        update: (e, dt) => { e.wing += dt * 12; e.phase += dt * e.vyWave; e.y = e.baseY + Math.sin(e.phase) * 16; },
      });
    }
  }

  function spawnBigBird() {
    const y = airY();
    entities.push({
      type: 'bigbird', x: W + 50, y, r: 28, wing: 0, baseY: y, phase: srand(0, 6.28), par: 1.7,
      update: (e, dt) => { e.wing += dt * 11; e.phase += dt * 0.9; e.y = e.baseY + Math.sin(e.phase) * 22; },
    });
  }

  function spawnCloud() {
    entities.push({ type: 'cloud', x: W + 40, y: airY(), r: srand(26, 40), got: false });
  }

  function spawnBonus(value, label) {
    const h = srand(90, 150);                     // zones vary in height (spec)
    const y = clamp(airY(), ceilingY + h / 2 + 10, floorY - h / 2 - 10);
    entities.push({ type: 'bonus', x: W + 40, y, w: 46, h, value, label: label || ('+' + value), got: false, pulse: 0,
      update: (e, dt) => { e.pulse += dt * 3; } });
  }

  function spawnMountain() {
    const h = srand(H * 0.26, H * 0.48);
    entities.push({ type: 'mountain', x: W + 40, h, w: h * mtnAspect });
  }

  function spawnTower() {
    entities.push({ type: 'tower', x: W + 40, w: srand(34, 52), h: srand(H * 0.18, H * 0.42) });
  }

  function spawnSmokeStack() {
    const h = srand(H * 0.16, H * 0.3);
    const toxic = srand(H * 0.18, H * 0.4);      // toxic smoke can stretch halfway up
    entities.push({ type: 'stack', x: W + 40, w: srand(26, 40), h, toxic, got: false, puff: 0,
      update: (e, dt) => { e.puff += dt; } });
  }

  function spawnJetStream() {
    const y = clamp(airY(), ceilingY + 60, floorY - 60);
    entities.push({ type: 'jet', x: W + 60, w: srand(220, 320), h: 54, y, got: false, par: 0.9, dash: 0,
      update: (e, dt) => { e.dash += dt * 600; } });
  }

  /* ---------------------------------------------------------- collisions */
  function planeBox() {
    const s = plane.size;
    return { x: plane.x - s * 0.55, y: plane.y - s * 0.32, w: s * 1.1, h: s * 0.64 };
  }
  function boxHit(b, x, y, w, h) { return b.x < x + w && b.x + b.w > x && b.y < y + h && b.y + b.h > y; }
  function circHit(b, cx, cy, r) {
    const nx = clamp(cx, b.x, b.x + b.w), ny = clamp(cy, b.y, b.y + b.h);
    return (cx - nx) ** 2 + (cy - ny) ** 2 <= r * r;
  }

  function checkCollisions() {
    const b = planeBox();
    for (const e of entities) {
      if (e.got || e.dead) continue;
      switch (e.type) {
        case 'bird':
          if (circHit(b, e.x, e.y, e.r * 0.8)) {
            e.dead = true; birdHits++;
            addScore(DATA.score.birdHit, e.x, e.y, 'bad');
            popups.push({ x: e.x, y: e.y - 26, text: 'BIRD STRIKE!', life: 1.3, kind: 'bad', big: true });
            Audio.play('splat'); burst(e.x, e.y, '#5b4636', 10);
            if (cb.onChatter) cb.onChatter('Bird Strike', false);
            if (birdHits >= DATA.maxBirdHits) crash('birds');
          }
          break;
        case 'bigbird':
          if (circHit(b, e.x, e.y, e.r * 0.85)) { Audio.play('big'); crash('bigbird'); }
          break;
        case 'cloud':
          if (circHit(b, e.x, e.y, e.r * 0.9)) {
            e.got = true; e.dead = true;
            addScore(DATA.score.cloud, e.x, e.y, 'good');
            Audio.play('cloud'); burst(e.x, e.y, 'rgba(255,255,255,0.9)', 12);
          }
          break;
        case 'bonus':
          if (boxHit(b, e.x - e.w / 2, e.y - e.h / 2, e.w, e.h)) {
            e.got = true; e.dead = true;
            const kind = e.value >= DATA.score.valley ? 'good' : 'good';
            addScore(e.value, e.x, e.y, kind);
            Audio.play(e.value >= DATA.score.valley ? 'ching' : 'bell');
            Audio.play('crowd');                               // authorization zone: bell + crowd (spec)
            burst(e.x, e.y, '#ffd166', 16);
          }
          break;
        case 'jet':
          if (boxHit(b, e.x, e.y - e.h / 2, e.w, e.h)) {
            e.got = true; e.dead = true;
            addScore(DATA.score.jetStream, plane.x, plane.y, 'good');
            Audio.play('jet'); burst(plane.x, plane.y, '#9ad7ff', 26);
            if (cb.onChatter) cb.onChatter('JET STREAM! +2000', false);
          }
          break;
        case 'mountain': {
          // collision triangle sits inside the visible rock (central spire) — lenient & fair
          const apexX = e.x + e.w * 0.5, peakH = e.h * 0.9, half = e.w * 0.3;
          if (plane.x > apexX - half && plane.x < apexX + half) {
            const dx = Math.abs(plane.x - apexX);
            const surf = floorY - peakH * (1 - dx / half);
            if (plane.y + b.h / 2 > surf) crash('mountain');
          }
          break;
        }
        case 'tower':
          if (boxHit(b, e.x, floorY - e.h, e.w, e.h)) crash('tower');
          // radar cab a bit wider
          else if (boxHit(b, e.x - 8, floorY - e.h, e.w + 16, 18)) crash('tower');
          break;
        case 'stack': {
          const stackTop = floorY - e.h;
          // solid chimney body = crash (like a tower). Matches the visible brick column.
          const chW = e.h * CHIMNEY_ASPECT, chCx = e.x + e.w / 2;
          if (boxHit(b, chCx - chW * 0.42, stackTop, chW * 0.84, e.h)) { crash('stack'); break; }
          // toxic smoke column above it (hazard -25, once)
          if (!e.smokeHit && boxHit(b, e.x - 4, stackTop - e.toxic, e.w + 8, e.toxic)) {
            e.smokeHit = true;
            addScore(DATA.score.toxicSmoke, plane.x, plane.y, 'bad');
            Audio.play('poof'); emitSmoke(plane.x, plane.y);
          }
          break;
        }
      }
    }
  }

  /* ---------------------------------------------------------- scoring */
  function addScore(delta, x, y, kind) {
    score = Math.max(0, score + delta);
    popups.push({ x, y, text: (delta > 0 ? '+' : '') + delta, life: 1.0, kind });
    if (cb.onScore) cb.onScore(score, kind);
  }

  function crash(reason) {
    if (window.NODIE) return;              // inspection mode: no game over
    if (crashing) return;
    crashing = true; crashTime = 0;
    plane.vy = -120;
    Audio.play('explode');
    burst(plane.x, plane.y, '#ff7a3c', 28);
    burst(plane.x, plane.y, '#ffd166', 20);
    if (cb.onChatter) cb.onChatter(pick(['Pull Up!', 'May Day May Day', 'Terrain Terrain Pull Up']), false);
  }

  function survive() {
    if (crashing) return;
    state = 'paused';            // freeze sim; show fireworks briefly
    Audio.play('fireworks'); Audio.play('ching');
    for (let i = 0; i < 40; i++)
      particles.push(mkParticle(rand(W * 0.2, W * 0.8), rand(H * 0.2, H * 0.6), rand(-120, 120), rand(-160, -20), rand(0.6, 1.2), pick(['#ffd166', '#ff6b9d', '#9ad7ff', '#4ade80']), rand(2, 5)));
    render();
    setTimeout(() => finish('survived'), 1100);
  }

  function finish(result) {
    state = 'over';
    cancelAnimationFrame(raf);
    if (cb.onEnd) cb.onEnd(result, score);
  }

  /* ---------------------------------------------------------- particles */
  function mkParticle(x, y, vx, vy, life, color, size) { return { x, y, vx, vy, life, maxLife: life, color, size }; }
  function burst(x, y, color, n) { for (let i = 0; i < n; i++) { const a = rand(0, 6.28), sp = rand(40, 260); particles.push(mkParticle(x, y, Math.cos(a) * sp, Math.sin(a) * sp, rand(0.3, 0.8), color, rand(2, 5))); } }
  function emitSmoke(x, y) { for (let i = 0; i < 3; i++) particles.push(mkParticle(x - 10, y, rand(-60, -10), rand(-20, 20), rand(0.4, 0.9), 'rgba(80,80,90,0.6)', rand(4, 9))); }

  /* ============================================================
     RENDERING
     ============================================================ */
  function render() {
    drawBackground();
    drawBgClouds();
    drawGround();
    drawPalms();
    drawCeilingFloor();
    for (const e of entities) drawEntity(e);
    drawParticles();
    if (!(crashing && plane.dead)) drawPlane();
    drawPopups();
  }

  function drawIdleBackdrop() {
    if (!ctx) return;
    drawBackground();
    farMtns = farMtns || []; palms = palms || []; bgClouds = bgClouds || [];
  }

  // Real sunset photo, cover-fit; falls back to a gradient until it loads.
  function drawBackground() {
    if (bgReady) {
      const iw = bgImg.width, ih = bgImg.height;
      const s = Math.max(W / iw, H / ih);
      const dw = iw * s, dh = ih * s;
      ctx.drawImage(bgImg, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#3a1b63'); g.addColorStop(0.55, '#d8597a'); g.addColorStop(1, '#ffc27a');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    // gentle top scrim so white HUD text stays legible over bright sky
    const sc = ctx.createLinearGradient(0, 0, 0, H * 0.22);
    sc.addColorStop(0, 'rgba(12,6,24,0.4)'); sc.addColorStop(1, 'rgba(12,6,24,0)');
    ctx.fillStyle = sc; ctx.fillRect(0, 0, W, H * 0.22);
  }

  function drawBgClouds() {
    for (const c of bgClouds) {
      ctx.fillStyle = 'rgba(255,225,205,0.18)';
      puff(c.x, c.y, 26 * c.s);
    }
  }
  function puff(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 6.28);
    ctx.arc(x + r * 0.9, y + r * 0.2, r * 0.75, 0, 6.28);
    ctx.arc(x - r * 0.9, y + r * 0.2, r * 0.7, 0, 6.28);
    ctx.arc(x + r * 0.3, y - r * 0.5, r * 0.7, 0, 6.28);
    ctx.fill();
  }

  function drawGround() {
    // dark foreground shore so obstacles are grounded; fades into the photo
    const g = ctx.createLinearGradient(0, floorY - 8, 0, H);
    g.addColorStop(0, 'rgba(18,10,28,0)');
    g.addColorStop(0.22, 'rgba(16,8,24,0.9)');
    g.addColorStop(1, '#0b0610');
    ctx.fillStyle = g;
    ctx.fillRect(0, floorY - 8, W, H - floorY + 8);
    // warm rim at the waterline
    ctx.fillStyle = 'rgba(255,150,80,0.35)';
    ctx.fillRect(0, floorY - 2, W, 2);
  }

  // Real palm silhouette, warped in horizontal slices so it bends in the wind:
  // the base stays planted while the crown/fronds sway + flutter.
  function drawPalms() {
    for (const p of palms) {
      const img = palmReady ? (palmImgs[p.img] || palmImgs[0]) : null;
      if (!img) { drawPalmVector(p); continue; }
      const baseY = floorY + 6;
      const h = p.h, w = h * img.width / img.height;
      // wind bend (px at the crown): slow sway + faster, smaller flutter — unique phase per palm
      const bend = (Math.sin(windT * 1.05 + p.phase) * p.sway
                  + Math.sin(windT * 3.1 + p.phase * 1.7) * p.flut) * h;
      const N = 16;
      for (let i = 0; i < N; i++) {
        const f0 = i / N, f1 = (i + 1) / N;              // 0 = trunk base, 1 = crown top
        const sy = img.height * (1 - f1), sh = img.height * (f1 - f0);
        const dy = baseY - h * f1, dH = h * (f1 - f0) + 0.7;  // tiny overlap hides seams
        const off = bend * Math.pow((f0 + f1) / 2, 1.6);  // offset grows toward the crown
        ctx.drawImage(img, 0, sy, img.width, sh, p.x - w / 2 + off, dy, w, dH);
      }
    }
  }

  function drawPalmVector(p) {            // fallback if the sprite hasn't loaded
    const baseX = p.x, baseY = floorY + 6, h = p.h, sway = Math.sin(windT + p.phase) * 8;
    ctx.strokeStyle = SIL; ctx.lineCap = 'round'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(baseX, baseY);
    ctx.quadraticCurveTo(baseX + 14, baseY - h * 0.6, baseX + 3 + sway, baseY - h); ctx.stroke();
    const tx = baseX + 3 + sway, ty = baseY - h;
    ctx.lineWidth = 3.5;
    for (let a = 0; a < 7; a++) {
      const ang = (-Math.PI / 2) + (a - 3) * 0.44, len = 44 + (a % 2) * 12;
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(ang) * len * 0.5, ty + Math.sin(ang) * len * 0.5 - 7,
                           tx + Math.cos(ang) * len, ty + Math.sin(ang) * len + 12); ctx.stroke();
    }
  }

  function drawCeilingFloor() {
    // 40k ft ceiling (crash line)
    ctx.save();
    ctx.setLineDash([12, 10]);
    ctx.strokeStyle = 'rgba(255,90,110,0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, ceilingY); ctx.lineTo(W, ceilingY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,90,110,0.95)';
    ctx.font = '700 12px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('40,000 ft CEILING', W / 2, ceilingY + 16);
    // floor penalty line
    ctx.setLineDash([8, 8]);
    ctx.strokeStyle = 'rgba(255,200,120,0.6)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, floorY); ctx.lineTo(W, floorY); ctx.stroke();
    ctx.restore();
  }

  /* ---- entity drawing ---- */
  function drawEntity(e) {
    switch (e.type) {
      case 'bird':      drawGull(e, false); break;
      case 'bigbird':   drawGull(e, true); break;
      case 'cloud':     drawCloud(e); break;
      case 'bonus':     drawBonus(e); break;
      case 'jet':       drawJet(e); break;
      case 'mountain':  drawMountain(e); break;
      case 'tower':     drawTower(e); break;
      case 'stack':     drawStack(e); break;
    }
  }

  // Small birds = animated crow sprite (10-frame flap); big "instant-die" birds = animated eagle (12-frame).
  function drawGull(e, big) {
    const r = e.r, flap = Math.sin(e.wing);
    if (!big && crowReady) {
      const fw = crowImg.width / CROW_FRAMES;
      const fi = Math.floor(e.wing * 1.6) % CROW_FRAMES;
      const dh = r * 4.2, dw = dh * (fw / crowImg.height);
      ctx.drawImage(crowImg, fi * fw, 0, fw, crowImg.height, e.x - dw / 2, e.y - dh / 2, dw, dh);
      return;
    }
    if (big && eagleReady) {
      const fw = eagleImg.width / EAGLE_FRAMES;
      const fi = Math.floor(e.wing * 1.4) % EAGLE_FRAMES;
      const dh = r * 3.6, dw = dh * (fw / eagleImg.height);   // bigger than small birds, not huge
      ctx.drawImage(eagleImg, fi * fw, 0, fw, eagleImg.height, e.x - dw / 2, e.y - dh / 2, dw, dh);
      return;
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    if (big) { ctx.shadowColor = 'rgba(255,210,70,0.95)'; ctx.shadowBlur = 20; }
    ctx.strokeStyle = big ? '#ffcf3b' : SIL;
    ctx.lineWidth = big ? 6 : 3.4;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const up = (0.55 + 0.42 * flap) * r;
    ctx.beginPath();
    ctx.moveTo(-r * 1.5, 0);
    ctx.quadraticCurveTo(-r * 0.6, -up, -r * 0.12, r * 0.05);
    ctx.quadraticCurveTo(0, r * 0.2, r * 0.12, r * 0.05);
    ctx.quadraticCurveTo(r * 0.6, -up, r * 1.5, 0);
    ctx.stroke();
    if (big) {
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffcf3b';
      ctx.beginPath(); ctx.ellipse(0, r * 0.12, r * 0.3, r * 0.22, 0, 0, 6.28); ctx.fill();
      ctx.fillStyle = '#e8503a';     // beak
      ctx.beginPath(); ctx.moveTo(r * 0.26, r * 0.04); ctx.lineTo(r * 0.52, r * 0.12); ctx.lineTo(r * 0.26, r * 0.2); ctx.fill();
    }
    ctx.restore();
  }

  function drawCloud(e) {
    ctx.save();
    ctx.shadowColor = 'rgba(255,220,180,0.7)'; ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(255,249,242,0.96)';
    puff(e.x, e.y, e.r);
    // warm underside
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,190,140,0.5)';
    puff(e.x, e.y + e.r * 0.35, e.r * 0.7);
    ctx.restore();
  }

  function drawBonus(e) {
    const halo = 0.5 + Math.sin(e.pulse) * 0.2;
    ctx.save();
    ctx.translate(e.x, e.y);
    const grd = ctx.createLinearGradient(0, -e.h / 2, 0, e.h / 2);
    const hot = e.value >= DATA.score.valley;
    grd.addColorStop(0, hot ? 'rgba(74,222,128,0.1)' : 'rgba(255,209,102,0.1)');
    grd.addColorStop(0.5, hot ? `rgba(74,222,128,${halo})` : `rgba(255,209,102,${halo})`);
    grd.addColorStop(1, hot ? 'rgba(74,222,128,0.1)' : 'rgba(255,209,102,0.1)');
    ctx.fillStyle = grd;
    roundRect(-e.w / 2, -e.h / 2, e.w, e.h, 12); ctx.fill();
    ctx.strokeStyle = hot ? 'rgba(74,222,128,0.9)' : 'rgba(255,209,102,0.95)';
    ctx.lineWidth = 2;
    roundRect(-e.w / 2, -e.h / 2, e.w, e.h, 12); ctx.stroke();
    // label
    ctx.fillStyle = '#fff';
    ctx.font = '800 15px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.save(); ctx.rotate(-Math.PI / 2);
    ctx.fillText(e.label, 0, 0);
    ctx.restore();
    ctx.restore();
  }

  function drawJet(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    const grd = ctx.createLinearGradient(0, -e.h / 2, 0, e.h / 2);
    grd.addColorStop(0, 'rgba(154,215,255,0.05)');
    grd.addColorStop(0.5, 'rgba(154,215,255,0.5)');
    grd.addColorStop(1, 'rgba(154,215,255,0.05)');
    ctx.fillStyle = grd;
    ctx.fillRect(0, -e.h / 2, e.w, e.h);
    // speed lines
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.lineWidth = 2; ctx.setLineDash([24, 18]); ctx.lineDashOffset = -e.dash % 42;
    for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(0, i * e.h * 0.3); ctx.lineTo(e.w, i * e.h * 0.3); ctx.stroke(); }
    ctx.setLineDash([]);
    ctx.fillStyle = '#eaf6ff';
    ctx.font = '800 16px Trebuchet MS, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('JET STREAM +2000', e.w / 2, 0);
    ctx.restore();
  }

  function drawMountain(e) {
    if (mtnReady) {
      ctx.drawImage(mtnImg, e.x, floorY - e.h, e.w, e.h);
      return;
    }
    // vector fallback until the sprite loads
    const apexX = e.x + e.w / 2, apexY = floorY - e.h;
    ctx.fillStyle = SIL;
    ctx.beginPath();
    ctx.moveTo(e.x, floorY); ctx.lineTo(apexX, apexY); ctx.lineTo(e.x + e.w, floorY);
    ctx.closePath(); ctx.fill();
  }

  function drawTower(e) {
    const top = floorY - e.h;
    ctx.fillStyle = SIL;
    // tapered shaft
    ctx.beginPath();
    ctx.moveTo(e.x + e.w * 0.18, floorY);
    ctx.lineTo(e.x + e.w * 0.30, top + 24);
    ctx.lineTo(e.x + e.w * 0.70, top + 24);
    ctx.lineTo(e.x + e.w * 0.82, floorY);
    ctx.closePath(); ctx.fill();
    // control cab + slanted roof
    ctx.fillRect(e.x - 6, top + 8, e.w + 12, 20);
    ctx.beginPath();
    ctx.moveTo(e.x - 8, top + 8); ctx.lineTo(e.x + e.w / 2, top - 8); ctx.lineTo(e.x + e.w + 8, top + 8);
    ctx.closePath(); ctx.fill();
    // antenna + red beacon
    ctx.strokeStyle = SIL; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(e.x + e.w / 2, top - 8); ctx.lineTo(e.x + e.w / 2, top - 20); ctx.stroke();
    ctx.fillStyle = '#ff5a6e';
    ctx.beginPath(); ctx.arc(e.x + e.w / 2, top - 22, 2.6, 0, 6.28); ctx.fill();
    // warm cab windows
    ctx.fillStyle = WIN;
    for (let wx = e.x; wx < e.x + e.w - 2; wx += 9) ctx.fillRect(wx + 2, top + 12, 5, 11);
    // rim light on sun-facing edge
    ctx.strokeStyle = RIM; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(e.x + e.w * 0.18, floorY); ctx.lineTo(e.x + e.w * 0.30, top + 24); ctx.stroke();
  }

  function drawStack(e) {
    const top = floorY - e.h, cx = e.x + e.w / 2;
    // billowing toxic smoke — real sprite (21-frame sequence) rising smoothly from the chimney top
    if (smokeReady) {
      const cw = smokeImg.width / SMOKE_COLS, ch = smokeImg.height / SMOKE_ROWS;
      const dh = e.toxic, dw = dh * (cw / ch);                 // plume billows wider than chimney
      const dx = cx - SMOKE_EMIT * dw, dy = top - dh;          // base centred on chimney top
      // native 50-frame continuous loop (frame 1 → last → back to 1) + cross-fade = smooth billowing
      const t = e.puff * 10;                                   // ~10 fps (GIF's native rate)
      const f0 = Math.floor(t) % SMOKE_FRAMES, f1 = (f0 + 1) % SMOKE_FRAMES;
      const frac = t - Math.floor(t);
      const sx0 = (f0 % SMOKE_COLS) * cw, sy0 = ((f0 / SMOKE_COLS) | 0) * ch;
      const sx1 = (f1 % SMOKE_COLS) * cw, sy1 = ((f1 / SMOKE_COLS) | 0) * ch;
      ctx.save();
      ctx.globalAlpha = 0.92 * (1 - frac);
      ctx.drawImage(smokeImg, sx0, sy0, cw, ch, dx, dy, dw, dh);
      ctx.globalAlpha = 0.92 * frac;
      ctx.drawImage(smokeImg, sx1, sy1, cw, ch, dx, dy, dw, dh);
      ctx.restore();
    } else {
      // vector fallback: drifting puffs
      for (let i = 0; i < 9; i++) {
        const f = i / 9;
        const sy = top - f * e.toxic;
        const sway = Math.sin(e.puff * 1.3 + i * 0.7) * (8 + f * 24);
        const rad = e.w * (0.55 + f * 1.35);
        const warm = 1 - f;
        ctx.fillStyle = `rgba(${90 + warm * 70},${78 + warm * 28},78,${0.34 * (1 - f)})`;
        ctx.beginPath(); ctx.arc(cx + sway, sy, rad, 0, 6.28); ctx.fill();
      }
    }
    // realistic chimney image (drawn over the smoke base so the plume emerges from the top opening)
    if (chimneyReady) {
      const chH = e.h, chW = chH * CHIMNEY_ASPECT;
      ctx.drawImage(chimneyImg, cx - chW / 2, floorY - chH, chW, chH);
    } else {
      // vector fallback: tapered silhouette + warn band + rim light
      ctx.fillStyle = SIL;
      ctx.beginPath();
      ctx.moveTo(e.x, floorY);
      ctx.lineTo(e.x + e.w * 0.16, top);
      ctx.lineTo(e.x + e.w * 0.84, top);
      ctx.lineTo(e.x + e.w, floorY);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(200,70,50,0.85)';
      ctx.fillRect(e.x + e.w * 0.14, top + 6, e.w * 0.72, 5);
      ctx.strokeStyle = RIM; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(e.x, floorY); ctx.lineTo(e.x + e.w * 0.16, top); ctx.stroke();
    }
  }

  function drawParticles() {
    for (const p of particles) {
      ctx.globalAlpha = clamp(p.life / p.maxLife, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, 6.28); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawPopups() {
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const u of popups) {
      ctx.globalAlpha = clamp(u.life, 0, 1);
      ctx.font = (u.big ? '900 26px ' : '800 20px ') + 'Trebuchet MS, sans-serif';
      ctx.fillStyle = u.big ? '#ff3b3b' : (u.kind === 'bad' ? '#ff5436' : '#4ade80');
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.45)';
      ctx.strokeText(u.text, u.x, u.y); ctx.fillText(u.text, u.x, u.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawPlane() {
    const s = plane.size;
    if (breezeMode && planeReady) {                     // real Breeze jet sprite (no shadow)
      const w = s * 3.4, h = w / planeAspect;           // keeps Breeze ~same after size bump
      ctx.save();
      ctx.translate(plane.x, plane.y);
      ctx.rotate(plane.angle);
      ctx.drawImage(planeImg, -w / 2, -h / 2, w, h);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(plane.x, plane.y);
    ctx.rotate(plane.angle);
    // soft shadow
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.beginPath(); ctx.ellipse(2, 6, s * 0.7, s * 0.3, 0, 0, 6.28); ctx.fill();
    // fuselage
    const body = ctx.createLinearGradient(0, -s * 0.4, 0, s * 0.4);
    body.addColorStop(0, '#ffffff'); body.addColorStop(1, '#d8dde6');
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(s * 0.95, 0);                       // nose
    ctx.quadraticCurveTo(s * 0.4, -s * 0.34, -s * 0.5, -s * 0.28);
    ctx.quadraticCurveTo(-s * 0.95, -s * 0.22, -s * 0.95, 0);
    ctx.quadraticCurveTo(-s * 0.95, s * 0.22, -s * 0.5, s * 0.28);
    ctx.quadraticCurveTo(s * 0.4, s * 0.34, s * 0.95, 0);
    ctx.fill();
    // tail fin
    ctx.fillStyle = '#ff7a59';
    ctx.beginPath();
    ctx.moveTo(-s * 0.7, -s * 0.1);
    ctx.lineTo(-s * 1.05, -s * 0.7);
    ctx.lineTo(-s * 0.55, -s * 0.12);
    ctx.fill();
    // wing
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.moveTo(s * 0.1, 0);
    ctx.lineTo(-s * 0.3, s * 0.7);
    ctx.lineTo(s * 0.35, s * 0.12);
    ctx.fill();
    // cockpit window
    ctx.fillStyle = '#2a6ed6';
    ctx.beginPath(); ctx.ellipse(s * 0.55, -s * 0.05, s * 0.16, s * 0.1, 0, 0, 6.28); ctx.fill();
    // windows stripe
    ctx.fillStyle = 'rgba(90,120,170,0.6)';
    ctx.fillRect(-s * 0.4, -s * 0.06, s * 0.7, s * 0.08);
    // warm sunset rim-light along the top of the fuselage
    ctx.strokeStyle = 'rgba(255,180,110,0.85)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(s * 0.9, -s * 0.02);
    ctx.quadraticCurveTo(s * 0.4, -s * 0.33, -s * 0.5, -s * 0.27);
    ctx.quadraticCurveTo(-s * 0.9, -s * 0.21, -s * 0.92, -s * 0.02);
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  return {
    init, start, pause, resume, stop, lift, getState: () => state, getSeed: () => currentSeed,
    _debug: () => ({ state, score, birdHits, timeLeft, entities: entities ? entities.length : 0,
      types: entities ? entities.reduce((a, e) => { a[e.type] = (a[e.type] || 0) + 1; return a; }, {}) : {},
      planeY: plane ? Math.round(plane.y) : null, planeX: plane ? Math.round(plane.x) : null, crashing,
      list: entities ? entities.map((e) => ({ t: e.type, x: Math.round(e.x), y: Math.round(e.y || 0), got: !!e.got })) : [] }),
  };
})();
