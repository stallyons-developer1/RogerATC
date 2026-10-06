/* ============================================================
   RogerATC — Audio engine
   All sound effects + ambient music are synthesized with the
   Web Audio API so the game is fully self-contained (no asset
   downloads, no CORS). The spec's YouTube music track can later
   be swapped in by replacing startMusic() with an <audio> loop.
   ============================================================ */

const Audio = (() => {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let musicPlaying = false;
  let musicMuted = false;
  let musicTimer = null;
  let birdTimer = null;

  function ensure() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.18;
    musicGain.connect(master);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.9;
    sfxGain.connect(master);
  }

  // iOS/Chrome require resume after a user gesture
  function unlock() {
    ensure();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function now() { return ctx.currentTime; }

  // ---- low-level helpers ----
  function tone(freq, dur, type = 'sine', gain = 0.3, when = 0, slideTo = null) {
    ensure();
    const t = now() + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(sfxGain);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function noise(dur, gain = 0.3, when = 0, filterFreq = 1000, type = 'lowpass') {
    ensure();
    const t = now() + when;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = type;
    filt.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(sfxGain);
    src.start(t); src.stop(t + dur);
  }

  // ---- named SFX ----
  const sfx = {
    wind()   { noise(0.22, 0.25, 0, 900, 'bandpass'); },                // tap-to-lift
    cloud()  { tone(520, 0.18, 'triangle', 0.25); noise(0.15, 0.12, 0, 2200, 'highpass'); },
    ching()  { tone(1318, 0.12, 'sine', 0.3); tone(1760, 0.18, 'sine', 0.25, 0.08); }, // money
    bell()   { tone(1046, 0.5, 'sine', 0.3); tone(1568, 0.5, 'sine', 0.2, 0.02); },     // bonus zone
    jet()    { tone(200, 0.6, 'sawtooth', 0.22, 0, 1200); noise(0.6, 0.18, 0, 3000, 'highpass'); }, // jet stream
    splat()  { noise(0.18, 0.4, 0, 500, 'lowpass'); tone(160, 0.14, 'square', 0.2, 0, 60); }, // bird hit
    poof()   { noise(0.3, 0.3, 0, 700, 'lowpass'); },                   // toxic smoke
    explode(){ noise(0.5, 0.6, 0, 400, 'lowpass'); tone(90, 0.45, 'sawtooth', 0.4, 0, 30); }, // crash
    big()    { tone(300, 0.3, 'square', 0.3, 0, 80); noise(0.5, 0.5, 0.1, 500); },     // big bird death
    fireworks() {
      for (let i = 0; i < 5; i++) {
        const d = i * 0.14;
        tone(600 + Math.random() * 800, 0.3, 'triangle', 0.2, d);
        noise(0.25, 0.18, d + 0.02, 3500, 'highpass');
      }
    },
    gull() {
      const base = 900 + Math.random() * 500;
      tone(base, 0.12, 'sine', 0.06, 0, base * 1.4);
      tone(base * 1.3, 0.1, 'sine', 0.05, 0.1, base);
    },
    click()  { tone(660, 0.06, 'square', 0.15); },
  };

  // ---- ambient music: gentle sunset arpeggio loop (mutable) ----
  const CHORD = [
    [261.63, 329.63, 392.0, 523.25],  // C
    [220.0, 277.18, 329.63, 440.0],   // Am
    [293.66, 349.23, 440.0, 587.33],  // Dm
    [196.0, 246.94, 392.0, 493.88],   // G
  ];
  let step = 0;

  function musicStep() {
    if (!musicPlaying) return;
    const chord = CHORD[Math.floor(step / 4) % CHORD.length];
    const note = chord[step % 4];
    const t = now();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = note;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    osc.connect(g); g.connect(musicGain);
    osc.start(t); osc.stop(t + 0.75);
    // soft bass every 4 steps
    if (step % 4 === 0) tone(chord[0] / 2, 0.8, 'sine', 0.18 * 2, 0);
    step++;
    musicTimer = setTimeout(musicStep, 320);
  }

  function startMusic() {
    ensure();
    if (musicPlaying) return;
    musicPlaying = true;
    musicStep();
    scheduleGulls();
  }
  function stopMusic() {
    musicPlaying = false;
    if (musicTimer) clearTimeout(musicTimer);
    if (birdTimer) clearTimeout(birdTimer);
  }
  // subtle seagull chirps in background (per spec, not mutable with music)
  function scheduleGulls() {
    if (!musicPlaying) return;
    if (Math.random() < 0.6) sfx.gull();
    birdTimer = setTimeout(scheduleGulls, 2500 + Math.random() * 3500);
  }

  function toggleMute() {
    ensure();
    musicMuted = !musicMuted;
    musicGain.gain.value = musicMuted ? 0 : 0.18;
    return musicMuted;
  }
  function isMuted() { return musicMuted; }

  return {
    unlock, sfx, startMusic, stopMusic, toggleMute, isMuted,
    play: (name) => { if (sfx[name]) sfx[name](); },
  };
})();
