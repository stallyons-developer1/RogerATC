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
  const screens = { auth: $('auth'), menu: $('menu'), leaderboard: $('leaderboard'), multiplayer: $('multiplayer'), mpresult: $('mpresult'), subscribe: $('subscribe'), messages: $('messages'), callsign: $('callsign'), howto: $('howto'), result: $('result'), pause: $('pause') };
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

  const BREEZE = !!window.BREEZE;       // Breeze free variant: no ranking, no subscriptions, MP free
  // ---- auth ----
  let currentUser = null;               // { email, verified, high_score } or null (guest)
  let authMode = 'login';
  let GOOGLE_CLIENT_ID = '';            // loaded from api/pubconfig.php
  let STRIPE_PK = '';
  async function api(action, data) { return call('auth.php', action, data); }
  async function mapi(action, data) { return call('match.php', action, data); }
  async function payapi(action, data) { return call('pay.php', action, data); }
  async function msgapi(action, data) { return call('msg.php', action, data); }
  async function call(file, action, data) {
    try {
      const res = await fetch('api/' + file + '?action=' + action, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
      });
      return await res.json();
    } catch (_) { return { error: 'Could not reach the server.' }; }
  }
  let mpMatch = null;                   // active multiplayer match { code, seed, level, role } or null
  let pendingJoin = new URLSearchParams(location.search).get('join');   // from an invite link ?join=CODE

  /* ---------------------------------------------------------- init */
  Game.init(canvas);
  el.best.textContent = highScore();
  buildCallsigns();
  updateMuteLabels();
  loadConfig();
  if (BREEZE) { hide($('leaderboardBtn')); hide($('premiumBtn')); }   // free, no ranking
  if (new URLSearchParams(location.search).get('nodie')) {            // inspection: keep the word bubble pinned
    setInterval(() => { const c = $('chatter'); if (c) { c.classList.remove('hidden'); if (!$('chatterText').textContent) $('chatterText').textContent = 'Roger, Wilco!'; } }, 150);
  }

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
      if (!currentUser) { flash(btn, 'Log in to play Multiplayer!'); return; }
      if (!BREEZE && !currentUser.sub_multiplayer) { openSubscribe(); return; }   // $4.99/mo gate (RogerATC only)
      openMultiplayer();
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
  $('startBtn').addEventListener('click', () => { Audio.unlock(); Audio.play('click'); Audio.startMusic(); mpMatch = null; goto('callsign'); });
  $('howToBtn').addEventListener('click', () => { Audio.play('click'); goto('howto'); });
  $('howBack').addEventListener('click', () => { Audio.play('click'); goto('menu'); });
  $('menuMute').addEventListener('click', () => { Audio.unlock(); const m = Audio.toggleMute(); if (!m) Audio.startMusic(); updateMuteLabels(); });

  /* ---------------------------------------------------------- leaderboard */
  $('leaderboardBtn').addEventListener('click', () => { Audio.play('click'); openLeaderboard(); });
  $('lbBack').addEventListener('click', () => { Audio.play('click'); goto('menu'); });
  function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
  async function openLeaderboard() {
    goto('leaderboard');
    const list = $('lbList'), meEl = $('lbMe');
    list.innerHTML = '<div class="lb-empty">Loading…</div>'; hide(meEl);
    const r = await api('leaderboard');
    const top = (r && r.top) || [];
    if (!top.length) {
      list.innerHTML = '<div class="lb-empty">No scores yet — be the first to fly!</div>';
    } else {
      list.innerHTML = '';
      top.forEach((row, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
        const d = document.createElement('div');
        d.className = 'lb-row' + (i < 3 ? ' top' + (i + 1) : '');
        d.innerHTML = `<span class="lb-rank">${medal}</span><span class="lb-name">${esc(row.name)}</span><span class="lb-score">${row.score}</span>`;
        list.appendChild(d);
      });
    }
    if (r && r.me) { meEl.innerHTML = `<span>Your rank: #${r.me.rank}</span><span>${r.me.score} pts</span>`; show(meEl); }
    else hide(meEl);
  }

  /* ---------------------------------------------------------- multiplayer */
  function mpMsg(t, ok) { const e = $('mpMsg'); e.textContent = t || ''; e.className = 'auth-msg' + (t ? (ok ? ' ok' : ' err') : ''); }
  function openMultiplayer() {
    mpMatch = null;
    hide($('mpCreated')); $('mpJoinCode').value = ''; mpMsg('');
    goto('multiplayer');
  }
  $('mpBack').addEventListener('click', () => { Audio.play('click'); mpMatch = null; goto('menu'); });

  $('mpCreate').addEventListener('click', async () => {
    Audio.unlock(); Audio.play('click'); mpMsg('Creating…', true);
    const r = await mapi('create', { level });
    if (r.error) { mpMsg(r.error, false); return; }
    mpMatch = { code: r.code, seed: r.seed, level: r.level, role: 'host' };
    $('mpCode').textContent = r.code; show($('mpCreated')); mpMsg('');
  });
  $('mpCreateStart').addEventListener('click', () => { Audio.unlock(); Audio.play('click'); Audio.startMusic(); launch(); });

  async function doJoin(code) {
    code = (code || '').trim().toUpperCase();
    if (code.length < 4) { mpMsg('Enter the match code.', false); return; }
    mpMsg('Joining…', true);
    const r = await mapi('join', { code });
    if (r.error) { mpMsg(r.error, false); return; }
    mpMatch = { code: r.code, seed: r.seed, level: r.level, role: 'guest' };
    Audio.startMusic(); launch();
  }
  $('mpJoinForm').addEventListener('submit', (e) => { e.preventDefault(); Audio.unlock(); Audio.play('click'); doJoin($('mpJoinCode').value); });
  $('mpCopyLink').addEventListener('click', async () => {
    Audio.play('click');
    if (!mpMatch) return;
    const link = location.origin + location.pathname + '?join=' + mpMatch.code;
    try { await navigator.clipboard.writeText(link); mpMsg('✅ Invite link copied — send it to a friend!', true); }
    catch (_) { mpMsg(link, true); }
  });

  let mpPoll = null;
  function mpSubmitAndShow(scoreVal) {
    const code = mpMatch.code, you = mpMatch.role;
    mapi('submit', { code, score: scoreVal });
    $('mpResultTitle').textContent = 'MATCH RESULT';
    $('mpResultTitle').classList.remove('survived');
    $('mpYouName').textContent = 'You';
    $('mpYouAv').textContent = (currentUser && currentUser.email ? currentUser.email[0] : 'Y').toUpperCase();
    $('mpYouScore').textContent = scoreVal;
    $('mpOppName').textContent = 'Opponent'; $('mpOppAv').textContent = '?'; $('mpOppScore').textContent = '—';
    $('mpStatus').textContent = 'Waiting for opponent to finish…';
    hide($('mpDone'));
    document.querySelectorAll('.mp-player').forEach((p) => p.classList.remove('winner'));
    goto('mpresult');
    clearInterval(mpPoll);
    const poll = async () => {
      const s = await mapi('status', { code });
      if (s.error) { $('mpStatus').textContent = s.error; return; }
      const opp = you === 'host' ? s.guest : s.host;
      if (opp) {
        $('mpOppName').textContent = opp.name;
        $('mpOppAv').textContent = (opp.name[0] || '?').toUpperCase();
        $('mpOppScore').textContent = opp.done ? opp.score : '…';
      }
      if (s.bothDone) {
        clearInterval(mpPoll); mpPoll = null;
        const youWin = s.winner === you, tie = s.winner === 'tie';
        $('mpResultTitle').textContent = tie ? "IT'S A TIE!" : (youWin ? 'YOU WIN! 🏆' : 'YOU LOST');
        if (youWin || tie) $('mpResultTitle').classList.add('survived');
        if (!tie) {
          const winEl = (youWin ? $('mpYouName') : $('mpOppName')).closest('.mp-player');
          winEl.classList.add('winner');
        }
        $('mpStatus').textContent = tie ? 'Dead heat — same score!' : (youWin ? 'You flew it better! 🏆' : 'Rematch for redemption!');
        Audio.play(youWin || tie ? 'fireworks' : 'poof');
        show($('mpDone'));
      }
    };
    poll();
    mpPoll = setInterval(poll, 2500);
  }
  $('mpDone').addEventListener('click', () => { Audio.play('click'); clearInterval(mpPoll); mpPoll = null; mpMatch = null; Game.stop(); goto('menu'); });

  /* ---------------------------------------------------------- subscribe / premium */
  function subMsg(t, ok) { const e = $('subMsg'); e.textContent = t || ''; e.className = 'auth-msg' + (t ? (ok ? ' ok' : ' err') : ''); }
  function openSubscribe() {
    document.querySelectorAll('#subscribe .plan-card').forEach((c) => {
      const owned = currentUser && ((c.dataset.plan === 'multiplayer' && currentUser.sub_multiplayer) || (c.dataset.plan === 'adfree' && currentUser.sub_adfree));
      c.classList.toggle('owned', !!owned);
      const btn = c.querySelector('.plan-btn'); if (btn) btn.textContent = owned ? '✓ Active' : 'Subscribe';
    });
    subMsg('');
    goto('subscribe');
  }
  $('subBack').addEventListener('click', () => { Audio.play('click'); goto('menu'); });
  $('premiumBtn').addEventListener('click', () => { Audio.play('click'); if (!currentUser) { setAuthMode('login'); goto('auth'); return; } openSubscribe(); });

  /* ---------------------------------------------------------- messaging */
  let msgPollTimer = null, convoWith = null, convoPollTimer = null, heartbeatTimer = null;
  function startHeartbeat() {
    if (heartbeatTimer || !currentUser) return;
    msgapi('ping');
    heartbeatTimer = setInterval(() => { if (currentUser) msgapi('ping'); }, 40000);
  }
  $('messagesBtn').addEventListener('click', () => { Audio.play('click'); if (!currentUser) { setAuthMode('login'); goto('auth'); return; } openMessages(); });
  $('msgBack').addEventListener('click', () => { Audio.play('click'); stopMsgPolling(); goto('menu'); });
  $('msgConvoBack').addEventListener('click', () => { Audio.play('click'); closeConvo(); });
  function stopMsgPolling() { clearInterval(msgPollTimer); clearInterval(convoPollTimer); msgPollTimer = convoPollTimer = null; convoWith = null; }
  function openMessages() {
    hide($('msgConvo')); show($('msgPlayers')); goto('messages');
    loadPlayers();
    clearInterval(msgPollTimer);
    msgPollTimer = setInterval(() => { if (!convoWith) loadPlayers(); }, 8000);
  }
  async function loadPlayers() {
    const r = await msgapi('players');
    const list = $('msgPlayers'), players = (r && r.players) || [];
    if (!players.length) { list.innerHTML = '<div class="msg-empty">No other players yet. Invite friends to join!</div>'; return; }
    list.innerHTML = '';
    players.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'msg-player-row';
      row.innerHTML = `<div class="msg-av">${esc((p.name[0] || '?').toUpperCase())}</div><span class="msg-name">${esc(p.name)}</span><span class="msg-dot ${p.online ? 'online' : ''}"></span>`;
      row.addEventListener('click', () => { Audio.play('click'); openConvo(p.id, p.name); });
      list.appendChild(row);
    });
  }
  function openConvo(id, name) {
    convoWith = id; $('msgWith').textContent = name;
    hide($('msgPlayers')); show($('msgConvo')); $('msgList').innerHTML = '';
    loadConvo();
    clearInterval(convoPollTimer); convoPollTimer = setInterval(loadConvo, 3000);
  }
  function closeConvo() {
    clearInterval(convoPollTimer); convoPollTimer = null; convoWith = null;
    hide($('msgConvo')); show($('msgPlayers')); loadPlayers();
  }
  async function loadConvo() {
    if (!convoWith) return;
    const r = await msgapi('conversation', { with: convoWith });
    if (r.error) return;
    $('msgDot').className = 'msg-dot ' + (r.online ? 'online' : '');
    const listEl = $('msgList');
    const atBottom = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight < 50;
    listEl.innerHTML = '';
    (r.messages || []).forEach((m) => {
      const bub = document.createElement('div');
      bub.className = 'msg-bubble ' + (m.mine ? 'mine' : 'theirs');
      bub.textContent = m.body;
      listEl.appendChild(bub);
    });
    if (atBottom) listEl.scrollTop = listEl.scrollHeight;
  }
  $('msgForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = $('msgInput'), text = input.value.trim();
    if (!text || !convoWith) return;
    input.value = '';
    await msgapi('send', { to: convoWith, body: text });
    loadConvo();
  });
  document.querySelectorAll('#subscribe .plan-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      Audio.play('click');
      if (!currentUser) { subMsg('Please log in first.', false); return; }
      subMsg('Opening secure checkout…', true);
      const r = await payapi('checkout', { plan: btn.dataset.plan });
      if (r.error) { subMsg(r.error, false); return; }
      location.href = r.url;                               // -> Stripe Checkout
    });
  });
  async function handlePayReturn() {
    const q = new URLSearchParams(location.search);
    const pay = q.get('pay');
    if (!pay) return false;
    history.replaceState(null, '', location.pathname);     // clean URL
    if (pay === 'success' && q.get('session_id')) {
      const r = await payapi('confirm', { session_id: q.get('session_id') });
      if (r.ok) {
        const me = await api('me'); if (me.user) currentUser = me.user;
        updateAccountUI(); openSubscribe();
        subMsg('🎉 Subscription active — enjoy!', true);
        return true;
      }
    }
    return false;
  }

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
  let curLevel = 'regular';
  function launch() {
    goto(null);
    show(hud);
    curLevel = mpMatch ? mpMatch.level : level;
    const callName = selectedCallsign === 'NO CALL SIGN' ? '' : selectedCallsign;
    el.callTag.textContent = mpMatch ? '⚔ VS' : (callName || 'SOLO');
    el.score.textContent = '0';
    el.best.textContent = highScore();
    el.timer.textContent = fmtTime(DATA.levels[curLevel]);

    Game.start({
      duration: DATA.levels[curLevel],
      seed: mpMatch ? mpMatch.seed : undefined,
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
    const dur = DATA.levels[curLevel];
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
    // don't interrupt — let the current line finish; skip new voice while still talking
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;
    try {
      const clean = text.replace(/[^\w\s!?.,'-]/g, '').trim();   // strip emoji/symbols
      if (!clean) return;
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.05; u.pitch = 0.9; u.volume = 0.55;
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
    if (currentUser) api('savescore', { score: scoreVal, callsign: selectedCallsign === 'NO CALL SIGN' ? null : selectedCallsign });   // sync to account
    if (mpMatch) { mpSubmitAndShow(scoreVal); return; }   // multiplayer -> match result

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
    updateAds();
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
    $('menuMute').textContent = m ? '🔇 Sound Off' : '🔊 Sound On';
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

  /* ---------------------------------------------------------- auth flow */
  function authMsg(text, ok) {
    const e = $('authMsg');
    e.textContent = text || '';
    e.className = 'auth-msg' + (text ? (ok ? ' ok' : ' err') : '');
  }
  function setAuthMode(m) {
    authMode = m;
    document.querySelectorAll('.auth-tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === m));
    $('authSubmit').textContent = m === 'login' ? 'LOG IN' : 'SIGN UP';
    $('authPass').setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    authMsg('');
  }
  document.querySelectorAll('.auth-tab').forEach((t) =>
    t.addEventListener('click', () => { Audio.play('click'); setAuthMode(t.dataset.tab); }));

  $('authForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    Audio.unlock();
    const email = $('authEmail').value.trim();
    const password = $('authPass').value;
    $('authSubmit').disabled = true;
    authMsg(authMode === 'login' ? 'Logging in…' : 'Creating account…', true);
    const r = await api(authMode, { email, password });
    $('authSubmit').disabled = false;
    if (r.error) { authMsg(r.error, false); return; }
    currentUser = r.user;
    enterApp();
  });

  $('guestBtn').addEventListener('click', () => { Audio.unlock(); Audio.play('click'); currentUser = null; enterApp(); });

  $('googleBtn').addEventListener('click', () => {
    Audio.play('click');
    if (!GOOGLE_CLIENT_ID) { authMsg('Google sign-in is being set up.', false); return; }
    initGoogle();   // (button normally renders itself; this is a fallback)
  });

  // ---- public config + Google Identity Services ----
  async function loadConfig() {
    try {
      const c = await (await fetch('api/pubconfig.php')).json();
      GOOGLE_CLIENT_ID = c.google_client_id || '';
      STRIPE_PK = c.stripe_pub || '';
    } catch (_) {}
    initGoogle();
  }
  function onGoogleCredential(resp) {
    (async () => {
      authMsg('Signing in with Google…', true);
      const r = await api('google', { credential: resp.credential });
      if (r.error) { authMsg(r.error, false); return; }
      currentUser = r.user; enterApp();
    })();
  }
  let _gsiTries = 0;
  function initGoogle() {
    if (!GOOGLE_CLIENT_ID) return;
    if (!(window.google && window.google.accounts && google.accounts.id)) {
      if (_gsiTries++ < 30) setTimeout(initGoogle, 300);     // wait for the GIS script to load
      return;
    }
    google.accounts.id.initialize({ client_id: GOOGLE_CLIENT_ID, callback: onGoogleCredential });
    const c = $('gsiButton');
    if (c) {
      c.innerHTML = '';
      google.accounts.id.renderButton(c, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'continue_with', width: 300 });
      hide($('googleBtn'));
    }
  }

  $('logoutBtn').addEventListener('click', async () => {
    Audio.play('click');
    clearInterval(heartbeatTimer); heartbeatTimer = null;
    await api('logout');
    currentUser = null;
    updateAccountUI();
    setAuthMode('login'); goto('auth');
  });

  function updateAccountUI() {
    const pill = $('userPill');
    if (currentUser) {
      pill.innerHTML = esc(currentUser.email) + (currentUser.verified ? '' : ' <span class="unverified">unverified</span>');
      show($('logoutBtn'));
      if (currentUser.high_score && currentUser.high_score > highScore()) saveHigh(currentUser.high_score);
      el.best.textContent = highScore();
      startHeartbeat();
    } else {
      pill.textContent = 'Guest • RogerATC';
      hide($('logoutBtn'));
    }
    updateAds();
  }
  // Ads show for everyone except Ad-Free subscribers. Real AdSense units activate once
  // the client has an approved domain + ca-pub-… id (see README); until then this is a slot.
  const AD_CLIENT = '';   // e.g. 'ca-pub-XXXXXXXXXXXXXXXX'
  function updateAds() {
    const showAds = !(currentUser && currentUser.sub_adfree);
    document.querySelectorAll('.ad-slot').forEach((s) => s.classList.toggle('hidden', !showAds));
  }

  function enterApp() {
    updateAccountUI();
    if (pendingJoin) {                                  // arrived via an invite link
      const code = pendingJoin; pendingJoin = null;
      openMultiplayer(); $('mpJoinCode').value = code; doJoin(code);
      return;
    }
    goto('menu');
  }

  async function boot() {
    const r = await api('me');
    currentUser = (r && r.user) || null;
    if (currentUser) {
      updateAccountUI();
      if (await handlePayReturn()) return;     // returned from Stripe -> stay on subscribe
      enterApp();
    } else { setAuthMode('login'); goto('auth'); }
  }
  boot();
})();
