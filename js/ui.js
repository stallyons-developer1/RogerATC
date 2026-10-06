/* ============================================================
   RogerATC — UI layer
   Screen flow, menus, call-sign picker, HUD binding, results,
   high-score persistence (localStorage), radio-chatter bubble
   with optional speech synthesis.
   ============================================================ */

(() => {
  const $ = (id) => document.getElementById(id);
  const show = (el) => el.classList.remove('hidden');
  const hide = (el) => el.classList.add('hidden');

  // ---- elements ----
  const screens = { menu: $('menu'), callsign: $('callsign'), howto: $('howto'), result: $('result'), pause: $('pause') };
  const hud = $('hud');
  const canvas = $('game');

  const el = {
    score: $('scoreValue'), timer: $('timerValue'), best: $('bestValue'),
    speed: $('speedValue'), needle: $('speedoNeedle'), callTag: $('callsignTag'),
    chatter: $('chatter'), chatterText: $('chatterText'),
    resultTitle: $('resultTitle'), resultMsg: $('resultMsg'),
    resultScore: $('resultScore'), resultBest: $('resultBest'), newBest: $('newBest'),
  };

  // ---- state ----
  let mode = 'solo';
  let level = 'regular';
  let selectedCallsign = 'NO CALL SIGN';
  let chatterTimer = null;
  const HS_KEY = 'rogeratc_highscore';
  const highScore = () => parseInt(localStorage.getItem(HS_KEY) || '0', 10);
  const saveHigh = (v) => localStorage.setItem(HS_KEY, String(v));

  /* ---------------------------------------------------------- init */
  Game.init(canvas);
  el.best.textContent = highScore();
  buildCallsigns();
  updateMuteLabels();

  /* ---------------------------------------------------------- screen helpers */
  function goto(name) {
    Object.values(screens).forEach(hide);
    hide(hud);
    if (screens[name]) show(screens[name]);
  }

  /* ---------------------------------------------------------- menu: mode/level */
  $('modeSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    Audio.unlock(); Audio.play('click');
    if (btn.dataset.mode === 'multi') {
      // Multiplayer requires subscription (spec) — gated in main version
      flash(btn, 'Multiplayer needs a $4.99/mo subscription — Solo is free!');
      return;
    }
    setActive('modeSeg', btn); mode = btn.dataset.mode;
  });

  $('levelSeg').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn'); if (!btn) return;
    Audio.unlock(); Audio.play('click');
    setActive('levelSeg', btn); level = btn.dataset.level;
  });

  function setActive(groupId, btn) {
    [...$(groupId).children].forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  }

  function flash(btn, msg) {
    const old = btn.querySelector('small').textContent;
    btn.querySelector('small').textContent = msg;
    btn.style.opacity = '1';
    setTimeout(() => { btn.querySelector('small').textContent = old; }, 2200);
  }

  /* ---------------------------------------------------------- menu buttons */
  $('startBtn').addEventListener('click', () => { Audio.unlock(); Audio.play('click'); Audio.startMusic(); goto('callsign'); });
  $('howToBtn').addEventListener('click', () => { Audio.play('click'); goto('howto'); });
  $('howBack').addEventListener('click', () => { Audio.play('click'); goto('menu'); });
  $('menuMute').addEventListener('click', () => { Audio.unlock(); const m = Audio.toggleMute(); if (!m) Audio.startMusic(); updateMuteLabels(); });

  /* ---------------------------------------------------------- call sign picker */
  function buildCallsigns() {
    const grid = $('callsignGrid');
    grid.innerHTML = '';
    DATA.callSigns.forEach((cs) => {
      const chip = document.createElement('button');
      chip.className = 'cs-chip';
      chip.textContent = cs;
      if (cs === selectedCallsign) chip.classList.add('sel');
      chip.addEventListener('click', () => {
        Audio.play('click');
        grid.querySelectorAll('.cs-chip').forEach((c) => c.classList.remove('sel'));
        chip.classList.add('sel');
        selectedCallsign = cs;
      });
      grid.appendChild(chip);
    });
  }
  $('callBack').addEventListener('click', () => { Audio.play('click'); goto('menu'); });
  $('callGo').addEventListener('click', () => { Audio.play('click'); launch(); });

  /* ---------------------------------------------------------- launch game */
  function launch() {
    goto(null);
    show(hud);
    const callName = selectedCallsign === 'NO CALL SIGN' ? '' : selectedCallsign;
    el.callTag.textContent = callName || 'SOLO';
    el.score.textContent = '0';
    el.best.textContent = highScore();
    el.timer.textContent = fmtTime(DATA.levels[level]);

    Game.start({
      duration: DATA.levels[level],
      callsign: callName,
      callbacks: {
        onScore: (v, kind) => {
          el.score.textContent = v;
          if (kind === 'good' || kind === 'bad') {
            el.score.classList.remove('flash-good', 'flash-bad');
            void el.score.offsetWidth;
            el.score.classList.add(kind === 'good' ? 'flash-good' : 'flash-bad');
          }
        },
        onSpeed: (mph) => {
          el.speed.textContent = mph;
          const t = (mph - DATA.speed.min) / (DATA.speed.max - DATA.speed.min);
          el.needle.style.transform = `translateX(-50%) rotate(${(-80 + t * 160)}deg)`;
        },
        onChatter: (text, isTakeoff) => showChatter(text, isTakeoff),
        onEnd: (result, scoreVal) => endGame(result, scoreVal),
      },
    });

    startTimerDisplay();
  }

  /* ---------------------------------------------------------- timer display */
  let timerRAF = null;
  function startTimerDisplay() {
    const dur = DATA.levels[level];
    const t0 = performance.now();
    cancelAnimationFrame(timerRAF);
    const tick = () => {
      const st = Game.getState();
      if (st === 'over' || st === 'idle') return;
      if (st === 'running') {
        const left = Math.max(0, dur - (performance.now() - t0 - pausedMs) / 1000);
        el.timer.textContent = fmtTime(left);
      }
      timerRAF = requestAnimationFrame(tick);
    };
    pausedMs = 0; pauseStart = 0;
    timerRAF = requestAnimationFrame(tick);
  }
  let pausedMs = 0, pauseStart = 0;
  function fmtTime(s) { s = Math.ceil(s); const m = Math.floor(s / 60); const r = s % 60; return `${m}:${r < 10 ? '0' : ''}${r}`; }

  /* ---------------------------------------------------------- radio chatter */
  function showChatter(text, isTakeoff) {
    el.chatterText.textContent = text;
    show(el.chatter);
    clearTimeout(chatterTimer);
    chatterTimer = setTimeout(() => hide(el.chatter), isTakeoff ? 3200 : 2600);
    if (!Audio.isMuted()) speak(text);
  }
  function speak(text) {
    if (!('speechSynthesis' in window)) return;
    try {
      // skip emoji-only / symbol bits
      const clean = text.replace(/[^\w\s!?.,'-]/g, '').trim();
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.05; u.pitch = 0.9; u.volume = 0.55;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (_) {}
  }

  /* ---------------------------------------------------------- result */
  function endGame(result, scoreVal) {
    cancelAnimationFrame(timerRAF);
    hide(hud); hide(el.chatter);
    const hs = highScore();
    const isBest = scoreVal > hs;
    if (isBest) saveHigh(scoreVal);

    if (result === 'survived') {
      el.resultTitle.textContent = 'YOU SURVIVED!';
      el.resultTitle.classList.add('survived');
      el.resultMsg.textContent = 'Well done! You flew the whole course. ROGER ATC!';
    } else {
      el.resultTitle.textContent = 'GAME OVER';
      el.resultTitle.classList.remove('survived');
      el.resultMsg.textContent = pick([
        'Mayday, mayday… try again!', 'The birds got you this time.',
        'Terrain terrain — pull up next run!', 'Shake it off, pilot. One more flight.',
      ]);
    }
    el.resultScore.textContent = scoreVal;
    el.resultBest.textContent = highScore();
    el.best.textContent = highScore();
    if (isBest) show(el.newBest); else hide(el.newBest);
    goto('result');
  }

  $('retryBtn').addEventListener('click', () => { Audio.play('click'); launch(); });
  $('homeBtn').addEventListener('click', () => { Audio.play('click'); Game.stop(); goto('menu'); });

  /* ---------------------------------------------------------- pause / resume */
  $('pauseBtn').addEventListener('click', () => {
    if (Game.getState() !== 'running') return;
    Audio.play('click'); Game.pause(); pauseStart = performance.now();
    show(screens.pause);
  });
  $('resumeBtn').addEventListener('click', () => {
    Audio.play('click'); hide(screens.pause);
    if (pauseStart) { pausedMs += performance.now() - pauseStart; pauseStart = 0; }
    Game.resume();
  });
  $('quitBtn').addEventListener('click', () => { Audio.play('click'); hide(screens.pause); Game.stop(); goto('menu'); });

  $('muteBtn').addEventListener('click', () => { const m = Audio.toggleMute(); if (!m) Audio.startMusic(); updateMuteLabels(); });
  function updateMuteLabels() {
    const m = Audio.isMuted();
    $('muteBtn').textContent = m ? '🔇' : '🔊';
    $('menuMute').textContent = m ? '🔇 Music Off' : '🔊 Music On';
  }

  /* ---------------------------------------------------------- input: lift */
  const liftL = $('liftLeft'), liftR = $('liftRight');
  function bindLift(btn) {
    const on = (e) => { e.preventDefault(); Audio.unlock(); Game.lift(); };
    btn.addEventListener('touchstart', on, { passive: false });
    btn.addEventListener('mousedown', on);
  }
  bindLift(liftL); bindLift(liftR);

  // keyboard
  window.addEventListener('keydown', (e) => {
    if (['Space', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault();
      if (Game.getState() === 'running') Game.lift();
    }
    if (e.code === 'Escape' && Game.getState() === 'running') $('pauseBtn').click();
  });
  // tap anywhere on the canvas also lifts (mobile friendly)
  canvas.addEventListener('touchstart', (e) => { if (Game.getState() === 'running') { e.preventDefault(); Audio.unlock(); Game.lift(); } }, { passive: false });
  canvas.addEventListener('mousedown', () => { if (Game.getState() === 'running') { Audio.unlock(); Game.lift(); } });

  function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

  // start on menu
  goto('menu');
})();
