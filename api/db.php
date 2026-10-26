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
  return $pdo;
}

// Record a human-readable payment status + message on a user, so the UI can tell them
// exactly what happened (active / payment failed + reason / past due / canceled).
function setPay($pdo, $uid, $status, $message, $provider = null) {
  if (!$uid) return;
  $pdo->prepare('UPDATE users SET pay_status = ?, pay_message = ?, pay_provider = COALESCE(?, pay_provider), pay_at = ? WHERE id = ?')
      ->execute([$status, $message, $provider, gmdate('c'), (int) $uid]);
}
