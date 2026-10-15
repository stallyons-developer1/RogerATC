/* ============================================================
   RogerATC — UI layer
   Screen flow, menus, call-sign picker, HUD binding, results,
   high-score persistence (localStorage), radio-chatter bubble
   with optional speech synthesis.
   ============================================================ */

(() => {
  const $ = (id) => document.getElementById(id);
  const show = (el) => el && el.classList.remove('hidden');
  const hide = (el) => el && el.classList.add('hidden');

  // ---- elements ----
  const screens = { auth: $('auth'), menu: $('menu'), leaderboard: $('leaderboard'), multiplayer: $('multiplayer'), mpresult: $('mpresult'), subscribe: $('subscribe'), myad: $('myad'), messages: $('messages'), callsign: $('callsign'), howto: $('howto'), result: $('result'), pause: $('pause') };
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
  let SQUARE = { enabled: false, appId: '', location: '', env: 'sandbox' };
  let payProvider = 'stripe';           // which provider the Subscribe buttons use
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
  const TESTUNLOCK = new URLSearchParams(location.search).get('unlock') === '1';   // ?unlock=1 → test MP/ranking without paying

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
      if (!currentUser) { setAuthMode('login'); goto('auth'); return; }   // guest → go to login
      if (!BREEZE && !currentUser.sub_multiplayer && !TESTUNLOCK) { openSubscribe(); return; }   // $4.99/mo gate (RogerATC only)
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
  if ($('fsBtn')) $('fsBtn').addEventListener('click', () => { Audio.play('click'); toggleFullscreen(); });
  if ($('fsBtnMenu')) $('fsBtnMenu').addEventListener('click', () => { Audio.play('click'); toggleFullscreen(); });

  /* ---------------------------------------------------------- leaderboard */
  $('leaderboardBtn').addEventListener('click', () => {
    Audio.play('click');
    if (!currentUser) { setAuthMode('login'); goto('auth'); return; }
    if (!currentUser.sub_multiplayer && !TESTUNLOCK) { openSubscribe(); return; }   // ranking needs the $4.99/mo subscription
    openLeaderboard();
  });
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
  function paintPlans() {
    document.querySelectorAll('#subscribe .plan-card').forEach((c) => {
      const owned = currentUser && ((c.dataset.plan === 'multiplayer' && currentUser.sub_multiplayer) || (c.dataset.plan === 'adfree' && currentUser.sub_adfree) || (c.dataset.plan === 'runad' && currentUser.sub_runad));
      c.classList.toggle('owned', !!owned);
      const btn = c.querySelector('.plan-btn');
      if (btn) btn.textContent = (owned && c.dataset.plan === 'runad') ? '📣 Manage My Ad' : (owned ? '✓ Active' : 'Subscribe');
    });
  }
  // Tell the player EXACTLY what happened with their payment (failed reason / past due / canceled).
  function renderPayBanner(status, message) {
    const b = $('payBanner'); if (!b) return;
    if (!message || status === 'active' || status === '') { b.classList.add('hidden'); return; }
    $('payBannerText').textContent = message;
    b.classList.remove('hidden', 'good', 'warn');
    if (status === 'past_due' || status === 'canceled' || status === 'inactive') b.classList.add('warn');  // amber; 'failed' stays red
  }
  async function openSubscribe() {
    paintPlans(); subMsg(''); renderPayBanner('', '');
    goto('subscribe');
    if (currentUser) {                                   // pull the freshest status for the banner + owned state
      const s = await payapi('status').catch(() => null);
      if (s && !s.error) {
        currentUser.sub_multiplayer = s.sub_multiplayer; currentUser.sub_adfree = s.sub_adfree; currentUser.sub_runad = s.sub_runad;
        paintPlans();
        renderPayBanner(s.pay_status, s.pay_message);
      }
    }
  }
  $('subBack').addEventListener('click', () => { Audio.play('click'); goto('menu'); });
  if ($('payBannerX')) $('payBannerX').addEventListener('click', async () => { Audio.play('click'); $('payBanner').classList.add('hidden'); await payapi('clearnotice').catch(() => {}); });
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
      const plan = btn.dataset.plan;
      if (plan === 'runad' && currentUser.sub_runad) { openMyAd(); return; }  // already subscribed → manage ad
      if (payProvider === 'square' && SQUARE.enabled) { openSquareModal(plan); return; }   // Square in-page card form
      subMsg('Opening secure checkout…', true);
      const r = await payapi('checkout', { plan });
      if (r.error) { subMsg(r.error, false); return; }
      location.href = r.url;                               // -> Stripe Checkout
    });
  });

  /* ---------------------------------------------------------- Square (in-page card) */
  async function squareapi(action, data) { return call('square.php', action, data); }
  const PLAN_AMOUNTS = { multiplayer: '4.99', adfree: '6.99', runad: '24.99' };
  let sqPayments = null, sqCard = null, sqPlan = '';
  function setupPay() {
    if (!SQUARE.enabled) return;
    show($('payProvider'));
    document.querySelectorAll('#provSeg .seg-btn').forEach((b) => b.addEventListener('click', () => {
      Audio.play('click');
      document.querySelectorAll('#provSeg .seg-btn').forEach((x) => x.classList.remove('active'));
      b.classList.add('active'); payProvider = b.dataset.prov;
    }));
    if (!document.getElementById('sqSdk')) {              // load the Web Payments SDK (sandbox or prod)
      const s = document.createElement('script'); s.id = 'sqSdk';
      s.src = SQUARE.env === 'production' ? 'https://web.squarecdn.com/v1/square.js' : 'https://sandbox.web.squarecdn.com/v1/square.js';
      document.head.appendChild(s);
    }
  }
  function waitSquare() { return new Promise((res, rej) => { let n = 0; const t = setInterval(() => { if (window.Square) { clearInterval(t); res(); } else if (n++ > 50) { clearInterval(t); rej(); } }, 150); }); }
  function sqMsg(t, ok) { const e = $('sqMsg'); e.textContent = t || ''; e.className = 'auth-msg' + (t ? (ok ? ' ok' : ' err') : ''); }
  async function openSquareModal(plan) {
    sqPlan = plan;
    $('sqTitle').textContent = `Subscribe — $${PLAN_AMOUNTS[plan]}/mo`;
    $('sqPayBtn').textContent = `Pay $${PLAN_AMOUNTS[plan]}/mo`;
    sqMsg(''); show($('sqModal'));
    try {
      if (!window.Square) { sqMsg('Loading secure card form…', true); await waitSquare(); }
      if (!sqPayments) sqPayments = window.Square.payments(SQUARE.appId, SQUARE.location);
      if (!sqCard) { sqCard = await sqPayments.card(); await sqCard.attach('#sq-card'); }
      sqMsg('');
    } catch (e) { sqMsg('Could not load the card form. Please try again.', false); }
  }
  if ($('sqCancel')) $('sqCancel').addEventListener('click', () => { Audio.play('click'); hide($('sqModal')); });
  if ($('sqPayBtn')) $('sqPayBtn').addEventListener('click', async () => {
    if (!sqCard) return;
    const btn = $('sqPayBtn'); btn.disabled = true; sqMsg('Processing…', true);
    try {
      const tok = await sqCard.tokenize();
      if (tok.status !== 'OK') { sqMsg((tok.errors && tok.errors[0] && tok.errors[0].message) || 'Card details invalid.', false); btn.disabled = false; return; }
      const resp = await squareapi('subscribe', { plan: sqPlan, source_id: tok.token });
      if (resp.ok) {
        const me = await api('me'); if (me.user) currentUser = me.user;
        updateAccountUI(); hide($('sqModal'));
        if (sqPlan === 'runad') { openMyAd(); myadMsg('🎉 Subscribed via Square! Now upload your ad.', true); }
        else { await openSubscribe(); subMsg('🎉 Subscription active via Square — enjoy!', true); }
      } else { sqMsg(resp.error || 'Payment failed.', false); }
    } catch (e) { sqMsg('Payment error — please try again.', false); }
    btn.disabled = false;
  });

  /* ---------------------------------------------------------- My Ad (Run an Ad) */
  function myadMsg(t, ok) { const e = $('myadMsg'); e.textContent = t || ''; e.classList.toggle('err', ok === false); }
  function renderMyAd(ad, box) {
    box = box || $('myadPreview');
    if (ad && ad.src) {
      box.innerHTML = ad.type === 'video'
        ? '<video src="' + ad.src + '" muted autoplay loop playsinline></video>'
        : '<img src="' + ad.src + '" alt="Your ad" />';
    } else {
      box.innerHTML = '<span class="ad-label">No ad uploaded yet</span>';
    }
  }
  async function openMyAd() {
    myadMsg(''); $('myadFileName').textContent = 'Choose image / video (max 20 MB)';
    goto('myad');
    const r = await call('ad.php', 'mine', {});
    if (r && r.ad) { renderMyAd(r.ad); if (r.ad.url) $('myadUrl').value = r.ad.url; }
    else renderMyAd(null);
  }
  // My Ad UI only exists on the paid (RogerATC) build — Breeze is free, so guard against missing nodes.
  if ($('myadForm')) {
    $('myadFile').addEventListener('change', () => {
      const f = $('myadFile').files[0];
      $('myadFileName').textContent = f ? f.name : 'Choose image / video (max 20 MB)';
    });
    $('myadForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = $('myadFile').files[0];
      if (!f) { myadMsg('Choose an image or video first.', false); return; }
      myadMsg('Uploading…', true);
      const fd = new FormData();
      fd.append('action', 'upload'); fd.append('media', f); fd.append('url', $('myadUrl').value.trim());
      let r; try { r = await (await fetch('api/ad.php?action=upload', { method: 'POST', body: fd })).json(); }
      catch (_) { r = { error: 'Could not reach the server.' }; }
      if (r.ok) { myadMsg('✅ Your ad is live — it now plays in the game!', true); renderMyAd(r.ad); }
      else myadMsg(r.error || 'Upload failed.', false);
    });
    $('myadBack').addEventListener('click', () => { Audio.play('click'); goto('menu'); });
  }
  async function handlePayReturn() {
    const q = new URLSearchParams(location.search);
    const pay = q.get('pay');
    if (!pay) return false;
    history.replaceState(null, '', location.pathname);     // clean URL
    if (pay === 'cancel') { await openSubscribe(); subMsg('Payment canceled — you can try again anytime.', false); return true; }
    if (pay === 'success' && q.get('session_id')) {
      const r = await payapi('confirm', { session_id: q.get('session_id') });
      if (r.ok) {
        const me = await api('me'); if (me.user) currentUser = me.user;
        updateAccountUI();
        if (r.plan === 'runad') { openMyAd(); myadMsg('🎉 Subscribed! Now upload your ad.', true); }
        else { openSubscribe(); subMsg('🎉 Subscription active — enjoy!', true); }
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
  function goFullscreen() {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    const already = document.fullscreenElement || document.webkitFullscreenElement;
    if (req && !already) { try { const r = req.call(el); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
  }
  function exitFullscreen() {
    const ex = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    if (ex && fs) { try { const r = ex.call(document); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
  }
  function isFullscreen() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
  function toggleFullscreen() { if (isFullscreen()) exitFullscreen(); else goFullscreen(); }
  function updateFsLabels() {
    const fs = isFullscreen();
    const m = $('fsBtnMenu'); if (m) m.textContent = fs ? '⛶ Exit Fullscreen' : '⛶ Fullscreen';
    const h = $('fsBtn'); if (h) h.textContent = fs ? '🗗' : '⛶';
  }
  document.addEventListener('fullscreenchange', updateFsLabels);
  document.addEventListener('webkitfullscreenchange', updateFsLabels);
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
          if (!isFinite(mph)) return;                 // guard against stale-cache NaN
          el.speed.textContent = mph;
          const maxS = DATA.speed.max || 700;
          const t = (mph - DATA.speed.min) / (maxS - DATA.speed.min);
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
  // Word bubble: queue text too (like the voice) — a new phrase waits until the current one finishes reading.
  let chatterQueue = [], chatterBusy = false;
  function showChatter(text, isTakeoff) {
    if (chatterBusy) { if (chatterQueue.length < 5) chatterQueue.push({ text, isTakeoff }); return; }
    displayChatter(text, isTakeoff);
  }
  function displayChatter(text, isTakeoff) {
    chatterBusy = true;
    el.chatterText.textContent = text;
    show(el.chatter);
    fitChatterText();                  // shrink the font so the text stays inside the bubble
    positionChatter();                 // snap above the plane right away (no flash)
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(chatterTimer);
      hide(el.chatter); chatterBusy = false;
      if (chatterQueue.length) { const n = chatterQueue.shift(); displayChatter(n.text, n.isTakeoff); }
    };
    clearTimeout(chatterTimer);
    if (!Audio.isMuted() && 'speechSynthesis' in window) {
      speak(text, finish);                               // hide + advance when the voice finishes reading
      chatterTimer = setTimeout(finish, 8000);           // safety so it never gets stuck
    } else {
      chatterTimer = setTimeout(finish, isTakeoff ? 3200 : 2600);
    }
  }
  // Shrink the bubble text until it fits inside the cloud (handles long phrases on small screens).
  function fitChatterText() {
    const t = el.chatterText;
    t.style.fontSize = '';
    let fs = parseFloat(getComputedStyle(t).fontSize) || 12, guard = 0;
    while ((t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1) && fs > 5 && guard++ < 40) {
      fs -= 0.5; t.style.fontSize = fs + 'px';
    }
  }
  // Audio bubble pinned at TOP-CENTRE, just BELOW the ceiling line so it never overlaps the line
  // or the HUD score cards at any resolution (client).
  function positionChatter() {
    const b = el.chatter;
    if (!b) return;
    b.style.left = '50%';
    b.style.bottom = 'auto';
    b.style.transform = 'translateX(-50%)';
    el.chatterText.style.transform = '';
    const cy = (Game.getCeiling && Game.getCeiling()) || 0;
    b.style.top = (cy > 0 ? Math.round(cy + 8) : 78) + 'px';   // 8px below the ceiling line
  }
  // Speak one phrase; calls onEnd when the voice finishes (so the bubble text advances in sync).
  function speak(text, onEnd) {
    const fire = () => { if (onEnd) { const f = onEnd; onEnd = null; f(); } };
    if (!('speechSynthesis' in window)) { fire(); return; }
    try {
      const clean = text.replace(/[^\w\s!?.,'-]/g, '').trim();   // strip emoji/symbols
      if (!clean) { fire(); return; }
      const u = new SpeechSynthesisUtterance(clean);
      u.rate = 1.03; u.pitch = 0.9; u.volume = 0.8;
      u.onend = u.onerror = fire;
      window.speechSynthesis.speak(u);
    } catch (_) { fire(); }
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
      el.resultMsg.textContent = pick([       // fail phrases — one at a time (client list)
        "It's a long way down isn't it?", 'Try not to do that again!', 'Wow!',
        "I didn't see that coming", 'Oh No, not again', "If it ain't one thing, it's two",
        'Texting while flying', 'Stay off the phone!', 'Keep your eyes on the skyline',
        'Keep your chin to the wind', "Don't want to hit that acid smoke",
        'These birds are something else :)', "Let's try this again", "I'm getting the hang of it",
        'Mayday Mayday ATC',
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
      SQUARE = { enabled: !!c.square_enabled, appId: c.square_app_id || '', location: c.square_location || '', env: c.square_env || 'sandbox' };
      setupPay();
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
    renderGoogleBtn();
    hide($('googleBtn'));
  }
  function renderGoogleBtn() {
    const c = $('gsiButton');
    if (!c || !(window.google && google.accounts && google.accounts.id)) return;
    const w = Math.round(Math.min(400, Math.max(240, c.clientWidth || 340)));   // match the form width (GIS max 400)
    c.innerHTML = '';
    google.accounts.id.renderButton(c, { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'continue_with', width: w });
  }
  // keep the Google button matching the form width on resize / rotate
  let _gsiRz; window.addEventListener('resize', () => { clearTimeout(_gsiRz); _gsiRz = setTimeout(renderGoogleBtn, 250); });

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
      // Identify players by username/call sign, not raw email, in both versions (client request)
      const uname = currentUser.callsign || (currentUser.email ? currentUser.email.split('@')[0] : 'Pilot');
      if (BREEZE) {
        pill.textContent = uname;
      } else {
        pill.innerHTML = esc(uname) + (currentUser.verified ? '' : ' <span class="unverified">unverified</span>');
      }
      show($('logoutBtn'));
      if (currentUser.high_score && currentUser.high_score > highScore()) saveHigh(currentUser.high_score);
      el.best.textContent = highScore();
      startHeartbeat();
    } else {
      pill.textContent = BREEZE ? 'Guest' : 'Guest • RogerATC';
      hide($('logoutBtn'));
    }
    updateAds();
  }
  // Ads show for everyone except Ad-Free subscribers. Real AdSense units activate once
  // the client has an approved domain + ca-pub-… id (see README); until then this is a slot.
  const AD_CLIENT = '';   // e.g. 'ca-pub-XXXXXXXXXXXXXXXX'
  async function updateAds() {
    // Breeze is free with no ads at all; RogerATC shows ads to everyone except Ad-Free subscribers.
    const showAds = !BREEZE && !(currentUser && currentUser.sub_adfree);
    document.querySelectorAll('.ad-slot').forEach((s) => s.classList.toggle('hidden', !showAds));
    if (!showAds) return;
    // show a live advertiser ad (image/video) if any "Run an Ad" creatives exist
    let ads = [];
    try { const r = await call('ad.php', 'active', {}); ads = (r && r.ads) || []; } catch (_) {}
    if (!ads.length) return;
    const ad = ads[Math.floor(Math.random() * ads.length)];
    const media = ad.type === 'video'
      ? '<video src="' + ad.src + '" muted autoplay loop playsinline></video>'
      : '<img src="' + ad.src + '" alt="Advertisement" />';
    const html = ad.url ? '<a href="' + ad.url + '" target="_blank" rel="noopener">' + media + '</a>' : media;
    document.querySelectorAll('.ad-slot').forEach((s) => { s.innerHTML = html; });
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
