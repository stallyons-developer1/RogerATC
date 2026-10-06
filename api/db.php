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
  return $pdo;
}
