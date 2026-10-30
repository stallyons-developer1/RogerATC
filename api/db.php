<?php
// SQLite connection for RogerATC auth.
// The DB file lives OUTSIDE the web root (/home/<user>/.rogeratc-data) so it
// can never be downloaded over HTTP. Created automatically on first use.

function db() {
  static $pdo = null;
  if ($pdo) return $pdo;

  $dir = __DIR__ . '/../../../.rogeratc-data';     // -> /home/<user>/.rogeratc-data
  if (!is_dir($dir)) @mkdir($dir, 0700, true);

  $pdo = new PDO('sqlite:' . $dir . '/auth.sqlite');
  $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
  $pdo->exec('PRAGMA journal_mode = WAL');
  $pdo->exec('CREATE TABLE IF NOT EXISTS users (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    email        TEXT UNIQUE NOT NULL,
    pass_hash    TEXT,
    provider     TEXT DEFAULT "email",
    verified     INTEGER DEFAULT 0,
    verify_token TEXT,
    callsign     TEXT,
    high_score   INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT CURRENT_TIMESTAMP
  )');
  // migrations for existing DBs
  foreach (['sub_multiplayer INTEGER DEFAULT 0', 'sub_adfree INTEGER DEFAULT 0', 'sub_runad INTEGER DEFAULT 0', 'last_seen TEXT',
            'pay_status TEXT', 'pay_message TEXT', 'pay_provider TEXT', 'pay_at TEXT',
            'stripe_customer TEXT', 'square_customer TEXT', 'survives INTEGER DEFAULT 0'] as $def) {
    try { $pdo->exec("ALTER TABLE users ADD COLUMN $def"); } catch (Exception $e) {}
  }
  $pdo->exec('CREATE TABLE IF NOT EXISTS messages (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    from_id    INTEGER NOT NULL,
    to_id      INTEGER NOT NULL,
    body       TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )');
  $pdo->exec('CREATE TABLE IF NOT EXISTS ads (
    user_id    INTEGER PRIMARY KEY,
    media      TEXT NOT NULL,
    type       TEXT NOT NULL,
    url        TEXT,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
  )');
  $pdo->exec('CREATE TABLE IF NOT EXISTS matches (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    code        TEXT UNIQUE NOT NULL,
    seed        INTEGER NOT NULL,
    level       TEXT DEFAULT "regular",
    host_id     INTEGER NOT NULL,
    guest_id    INTEGER,
    host_score  INTEGER DEFAULT 0,
    guest_score INTEGER DEFAULT 0,
    host_done   INTEGER DEFAULT 0,
    guest_done  INTEGER DEFAULT 0,
    mode        TEXT DEFAULT "duel",
    status      TEXT DEFAULT "waiting",
    created_at  TEXT DEFAULT CURRENT_TIMESTAMP
  )');
  foreach (['mode TEXT DEFAULT "duel"', 'status TEXT DEFAULT "waiting"'] as $def) {
    try { $pdo->exec("ALTER TABLE matches ADD COLUMN $def"); } catch (Exception $e) {}
  }
  // one row per player for GROUP matches (3-20). Duel still uses the host/guest columns above.
  $pdo->exec('CREATE TABLE IF NOT EXISTS match_players (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id   INTEGER NOT NULL,
    user_id    INTEGER NOT NULL,
    score      INTEGER DEFAULT 0,
    done       INTEGER DEFAULT 0,
    joined_at  TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(match_id, user_id)
  )');

  // ---- Dash Contests: best of N seeded flights, 10-21 players ----
  // Timing fields (expires_at/starts_at/ends_at/issued_at/joined_at) are epoch MILLISECONDS so the
  // JS client can compare them directly to its server_now clock. Money is always cents (integers).
  $pdo->exec('CREATE TABLE IF NOT EXISTS dash_contests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT UNIQUE NOT NULL,
    host_id         INTEGER,
    status          TEXT NOT NULL DEFAULT "lobby",   -- lobby|starting|running|finished|cancelled
    entry_fee_cents INTEGER NOT NULL DEFAULT 0,       -- 0 = free (Phase 1 / Breeze): no fee, no prizes
    prizes_cents    TEXT NOT NULL DEFAULT "[]",       -- JSON [1st,2nd,3rd]
    matches         INTEGER NOT NULL DEFAULT 21,
    min_players     INTEGER NOT NULL DEFAULT 10,
    max_players     INTEGER NOT NULL DEFAULT 21,
    time_limit_ms   INTEGER NOT NULL DEFAULT 25000,   -- per-flight clock (short dash flights)
    seed            INTEGER NOT NULL,                 -- same seed → identical flights for everyone
    expires_at      INTEGER NOT NULL,                 -- lobby closes then if not started
    starts_at       INTEGER,
    ends_at         INTEGER,
    finished_at     INTEGER,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      INTEGER
  )');
  $pdo->exec('CREATE INDEX IF NOT EXISTS idx_dash_status ON dash_contests(status)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS dash_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    dash_contest_id INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    status          TEXT NOT NULL DEFAULT "invited",  -- invited|declined|joined|left|removed
    payment_status  TEXT NOT NULL DEFAULT "none",     -- none|held|charged|released|refunded (Phase 2)
    gateway         TEXT,
    payment_ref     TEXT,
    played          INTEGER NOT NULL DEFAULT 0,
    completed       INTEGER NOT NULL DEFAULT 0,        -- flights survived → the ratio
    total_score     INTEGER NOT NULL DEFAULT 0,        -- tiebreak: higher total score wins
    place           INTEGER,
    prize_cents     INTEGER NOT NULL DEFAULT 0,
    payout_note     TEXT,
    paid_out_at     INTEGER,
    joined_at       INTEGER,
    finished_at     INTEGER,
    created_at      TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at      INTEGER,
    UNIQUE(dash_contest_id, user_id)
  )');
  $pdo->exec('CREATE INDEX IF NOT EXISTS idx_dash_entry_user ON dash_entries(user_id, status)');
  $pdo->exec('CREATE TABLE IF NOT EXISTS dash_plays (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    dash_entry_id INTEGER NOT NULL,
    match_no      INTEGER NOT NULL,
    issued_at     INTEGER NOT NULL,                   -- when the server handed out the flight
    result        TEXT,                               -- won(survived)|crashed|timeout
    duration_ms   INTEGER,
    score         INTEGER DEFAULT 0,
    created_at    TEXT DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(dash_entry_id, match_no)
  )');
  return $pdo;
}

// Record a human-readable payment status + message on a user, so the UI can tell them
// exactly what happened (active / payment failed + reason / past due / canceled).
function setPay($pdo, $uid, $status, $message, $provider = null) {
  if (!$uid) return;
  $pdo->prepare('UPDATE users SET pay_status = ?, pay_message = ?, pay_provider = COALESCE(?, pay_provider), pay_at = ? WHERE id = ?')
      ->execute([$status, $message, $provider, gmdate('c'), (int) $uid]);
}
