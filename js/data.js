/* ============================================================
   RogerATC — Game data & tuning constants
   All values trace back to "ATC MAYDAY Spec.docx".
   ============================================================ */

const DATA = {
  // ---- Call signs (spec p.202-204) ----
  callSigns: [
    'DESTINATION 777', 'ARBITRAGE 843', 'CYCLOPSE 403', 'CALM 455', 'RELAX 943',
    'BREATHE 499', 'BARBADOS 398', 'ROMEO 453', 'JORDAN 593', 'BAY 833',
    'STUDIO 834', 'SALLY 323', 'RALLY 984', 'RADIO 094', "LET'S GO 029",
    'GOLDEN 503', 'HORIZON 948', 'LUCY GOOSEY 506', 'COUGAR 453', 'TIGER 827',
    'TEDDYBEAR 140', 'BREAKER 287', 'FLASH 277', 'CASH 028', 'GOOSE 990',
    'MAVERICK 877', 'NO CALL SIGN',
  ],

  // ---- Radio chatter (spec p.211-256), trimmed to game-friendly lines ----
  chatter: [
    'Roger', 'Wilco', 'Say Again', 'Standby', 'Say Altitude', 'Say Heading',
    "What's Your Heading?", 'Speak Slower', "What's Your Squawk", 'Pull Up!',
    'You can do it!', 'Copy that!', 'Keep moving forward 😊', 'Hang in there!',
    "Let's get some points!", "You're doing awesome.", "I'm proud of you.",
    'Stay strong! Be courageous!', 'Keep Going!', "You've got this.",
    'Turning Left', 'Turning Right', 'This too shall pass.', 'Good Job!',
    "It's too many birds up here man!", 'Stay away from the Smoke Stack!',
    'Whatever you do, Don’t Stop!', 'Traffic in sight', 'Maintain 320',
    'Copy loud and clear', 'Affirmative', 'Negative', 'Correction',
    'Wow… that was close!', 'Cleared to land', 'Terrain Terrain Pull Up',
    'Fire Warning!', 'You smell smoke?', 'May Day May Day', 'Pan Pan Pan',
    "It's beautiful up here!", 'Niner Niner Niner', 'Continue Approach',
    'Trust but Verify', 'Committed… Climbing', 'On our way!', 'Press On',
    "That's the way I like it!", "Let's Go!", 'How fast are we going?',
  ],

  // Shown once at takeoff, references the chosen call sign
  takeoffLine: (cs) => `Traffic, ${cs}… you are cleared for takeoff!`,

  // ---- Physics (Flappy-bird style, spec p.44) ----
  physics: {
    gravity: 1300,       // px/s^2 downward pull
    lift: -430,          // px/s impulse per tap
    maxFall: 620,        // terminal velocity
    maxRise: -520,
  },

  // ---- Scoring (spec values) ----
  score: {
    cloud: 25,           // +25 per cloud (p.133)
    bonusZone: 100,      // Authorization / bonus zone (p.16,39)
    peak: 300,           // Mountain peak / smoke-stack risk (p.89,155)
    valley: 500,         // Valley zone (p.99)
    jetStream: 2000,     // Jet stream (p.6,103)
    birdHit: -25,        // small bird (p.12,14)
    toxicSmoke: -25,     // toxic smoke (p.93)
    floorHit: -50,       // bottom line (p.8)
  },

  // ---- Durations (spec p.194-195) ----
  levels: {
    regular: 90,         // 1.5 min
    extended: 150,       // 2.5 min
  },

  speed: { min: 499, max: 533 },  // speedometer MPH (p.206)

  maxBirdHits: 3,        // 3 small birds => go down (p.14)
};
