# RogerATC — "ATC MAYDAY"  ✈️

A Flappy-Bird–style aviation obstacle-course game, built to the **ATC MAYDAY Spec**.
This is the **Main Version (RogerATC)** — the primary deliverable. The free
**BreezeRogerATC.com** variant is planned as Phase 2 (see below).

Fully vector-rendered on an HTML5 Canvas, no external assets or build step.

---

## ▶️ How to run

Just open **`index.html`** in any modern browser (Chrome, Safari, Edge, Firefox).
No server or install needed.

- **Lift:** tap the **LEFT / RIGHT** buttons, tap anywhere on screen, or press
  `Space` / `↑` / `←` / `→`. The plane falls on its own — keep tapping to climb.
- **Pause:** `Esc` or the ⏸ button. **Mute music:** 🔊 button.

> Audio & voice start on your first click (browser autoplay policy).

---

## ✅ Implemented (from spec)

| Area | Details |
|------|---------|
| **Flight** | Flappy-style gravity + tap-to-lift, wind SFX, plane tilt |
| **Obstacle course** | Birds (−25, 3 = down), Big Yellow Birds (instant DIE), Mountains & Towers (crash), Smoke stacks + toxic smoke (−25), Clouds (+25), **Jet Stream (+2000)**, Bonus/Authorization zones (+100 / +300 / +500) |
| **Lines** | 40,000 ft ceiling (crash), floor penalty (−50) |
| **HUD** | Score, Best, course timer, speedometer (499–533 MPH), call-sign tag |
| **Radio chatter** | Word bubble above the speedometer + spoken voice (aviation + motivational lines from spec) |
| **Call signs** | Full spec list (Lucy Goosey 506, Maverick 877, … or No Call Sign) |
| **Modes** | **Solo = Free** (playable). **Multiplayer = $4.99/mo** (gated per spec) |
| **Levels** | Regular (1:30) & Extended (2:30) |
| **End states** | "GAME OVER" and **"YOU SURVIVED!"** + fireworks |
| **Audio** | Synthesized background music loop (mutable) + seagull ambience + all SFX |
| **Theme** | Sunset gradient, sun, palm trees, parallax scrolling |
| **Persistence** | Personal high score saved in `localStorage` |

## 🗂️ Structure

```
index.html        # screens + canvas + HUD
css/style.css     # sunset / glassmorphism UI
js/data.js        # call signs, chatter lines, scoring & tuning constants
js/audio.js       # Web-Audio synth SFX + ambient music
js/game.js        # canvas engine: physics, spawning, collisions, scoring, render
js/ui.js          # screen flow, HUD binding, high score, chatter + speech
```

---

## 🔜 Phase 2 — BreezeRogerATC.com (free variant)

Same game, derived from this codebase via a config flag:
Solo **and** Multiplayer free, **no ranking**, **no subscriptions**, plus a
**mascot at the bottom**. (The logo `RogerATC logo 01.jpg` can inform the mascot.)

## 📝 Notes / to confirm with client
- **Music:** currently a self-contained synth loop. The spec's YouTube track can be
  swapped in (replace `startMusic()` in `js/audio.js` with a hosted `<audio>` loop).
- **Multiplayer, messaging, invites, sign-up (email/Google), ads & subscriptions**
  are product/backend features — scaffolded in the UI, to be wired to a backend next.
- Real multiplayer needs the "same terrain" seed + matchmaking server (Phase 2/3).

---

## ⚠️ Music licensing note
`assets/music.mp3` is a 3-minute clip of the client-provided YouTube track
("Smoke And Chill — Lofi Hip Hop & Chillhop Mix", id JqLIV9QzYt8), looped as
background music. This is copyrighted music — the **client must secure the rights
/ license** to use it in a commercial product. Swap `assets/music.mp3` with a
licensed or royalty-free track when ready (no code change needed).
