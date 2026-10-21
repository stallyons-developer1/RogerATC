<?php
// RogerATC multiplayer — create/join a match (same seed), submit score, poll status.
require __DIR__ . '/db.php';

session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
]);
session_start();

function out($d, $c = 200) { http_response_code($c); header('Content-Type: application/json'); echo json_encode($d); exit; }
function body() { $j = json_decode(file_get_contents('php://input'), true); return is_array($j) ? $j : $_POST; }
function uid() { return $_SESSION['uid'] ?? null; }
function code6() {
  $a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; $s = '';
  for ($i = 0; $i < 6; $i++) $s .= $a[random_int(0, strlen($a) - 1)];
  return $s;
}
function uname($pdo, $id) {
  if (!$id) return null;
  $q = $pdo->prepare('SELECT email, callsign FROM users WHERE id = ?'); $q->execute([$id]);
  $u = $q->fetch(PDO::FETCH_ASSOC);
  return $u ? ($u['callsign'] ?: explode('@', $u['email'])[0]) : 'Pilot';
}

$pdo = db();
$action = $_GET['action'] ?? (body()['action'] ?? '');
if (!uid()) out(['error' => 'Please log in to play multiplayer.'], 401);

if ($action === 'create') {
  $level = (body()['level'] ?? 'regular') === 'extended' ? 'extended' : 'regular';
  $seed  = random_int(1, 2000000000);
  do { $code = code6(); $c = $pdo->prepare('SELECT 1 FROM matches WHERE code = ?'); $c->execute([$code]); } while ($c->fetch());
  $pdo->prepare('INSERT INTO matches (code, seed, level, host_id) VALUES (?,?,?,?)')
      ->execute([$code, $seed, $level, uid()]);
  out(['ok' => true, 'code' => $code, 'seed' => $seed, 'level' => $level, 'role' => 'host']);
}

if ($action === 'join') {
  $code = strtoupper(trim(body()['code'] ?? ''));
  $q = $pdo->prepare('SELECT * FROM matches WHERE code = ?'); $q->execute([$code]);
  $m = $q->fetch(PDO::FETCH_ASSOC);
  if (!$m) out(['error' => 'Match not found — check the code.'], 404);
  if ($m['host_id'] == uid()) out(['error' => "That's your own match code."], 400);
  if ($m['guest_id'] && $m['guest_id'] != uid()) out(['error' => 'This match is already full.'], 409);
  $pdo->prepare('UPDATE matches SET guest_id = ? WHERE id = ?')->execute([uid(), $m['id']]);
  out(['ok' => true, 'code' => $code, 'seed' => (int) $m['seed'], 'level' => $m['level'],
       'role' => 'guest', 'opponent' => uname($pdo, $m['host_id'])]);
}

if ($action === 'submit') {
  $b = body(); $code = strtoupper(trim($b['code'] ?? '')); $score = (int) ($b['score'] ?? 0);
  $q = $pdo->prepare('SELECT * FROM matches WHERE code = ?'); $q->execute([$code]);
  $m = $q->fetch(PDO::FETCH_ASSOC);
  if (!$m) out(['error' => 'Match not found.'], 404);
  if (uid() == $m['host_id'])       $pdo->prepare('UPDATE matches SET host_score = ?, host_done = 1 WHERE id = ?')->execute([$score, $m['id']]);
  elseif (uid() == $m['guest_id'])  $pdo->prepare('UPDATE matches SET guest_score = ?, guest_done = 1 WHERE id = ?')->execute([$score, $m['id']]);
  else out(['error' => 'You are not in this match.'], 403);
  out(['ok' => true]);
}

if ($action === 'status') {
  $code = strtoupper(trim($_GET['code'] ?? (body()['code'] ?? '')));
  $q = $pdo->prepare('SELECT * FROM matches WHERE code = ?'); $q->execute([$code]);
  $m = $q->fetch(PDO::FETCH_ASSOC);
  if (!$m) out(['error' => 'Match not found.'], 404);
  $both = $m['host_done'] && $m['guest_done'];
  $winner = null;
  if ($both) $winner = $m['host_score'] == $m['guest_score'] ? 'tie' : ($m['host_score'] > $m['guest_score'] ? 'host' : 'guest');
  out([
    'code'  => $code,
    'seed'  => (int) $m['seed'],
    'level' => $m['level'],
    'you'   => uid() == $m['host_id'] ? 'host' : 'guest',
    'host'  => ['name' => uname($pdo, $m['host_id']),  'score' => (int) $m['host_score'],  'done' => (bool) $m['host_done']],
    'guest' => $m['guest_id'] ? ['name' => uname($pdo, $m['guest_id']), 'score' => (int) $m['guest_score'], 'done' => (bool) $m['guest_done']] : null,
    'bothDone' => (bool) $both,
    'winner'   => $winner,
  ]);
}

/* ===================== GROUP MODE (3-20 players) ===================== */
const GROUP_MIN = 3, GROUP_MAX = 20;
function mByCode($pdo, $code) { $q = $pdo->prepare('SELECT * FROM matches WHERE code = ?'); $q->execute([$code]); return $q->fetch(PDO::FETCH_ASSOC); }
function groupPlayers($pdo, $mid) {
  $q = $pdo->prepare('SELECT user_id, score, done FROM match_players WHERE match_id = ? ORDER BY joined_at ASC, id ASC'); $q->execute([$mid]);
  $out = [];
  foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $r)
    $out[] = ['id' => (int) $r['user_id'], 'name' => uname($pdo, $r['user_id']), 'score' => (int) $r['score'], 'done' => (bool) $r['done']];
  return $out;
}

if ($action === 'gcreate') {
  $level = (body()['level'] ?? 'regular') === 'extended' ? 'extended' : 'regular';
  $seed  = random_int(1, 2000000000);
  do { $code = code6(); $c = $pdo->prepare('SELECT 1 FROM matches WHERE code = ?'); $c->execute([$code]); } while ($c->fetch());
  $pdo->prepare('INSERT INTO matches (code, seed, level, host_id, mode, status) VALUES (?,?,?,?,"group","waiting")')->execute([$code, $seed, $level, uid()]);
  $mid = (int) $pdo->lastInsertId();
  $pdo->prepare('INSERT OR IGNORE INTO match_players (match_id, user_id) VALUES (?,?)')->execute([$mid, uid()]);
  out(['ok' => true, 'code' => $code, 'seed' => $seed, 'level' => $level, 'host' => true]);
}

if ($action === 'gjoin') {
  $code = strtoupper(trim(body()['code'] ?? ''));
  $m = mByCode($pdo, $code);
  if (!$m || $m['mode'] !== 'group') out(['error' => 'Group room not found — check the code.'], 404);
  if ($m['status'] !== 'waiting') out(['error' => 'This group has already started.'], 409);
  $chk = $pdo->prepare('SELECT 1 FROM match_players WHERE match_id = ? AND user_id = ?'); $chk->execute([$m['id'], uid()]);
  if (!$chk->fetch()) {
    $cnt = $pdo->prepare('SELECT COUNT(*) FROM match_players WHERE match_id = ?'); $cnt->execute([$m['id']]);
    if ((int) $cnt->fetchColumn() >= GROUP_MAX) out(['error' => 'This group is full (' . GROUP_MAX . ' players).'], 409);
    $pdo->prepare('INSERT OR IGNORE INTO match_players (match_id, user_id) VALUES (?,?)')->execute([$m['id'], uid()]);
  }
  out(['ok' => true, 'code' => $code, 'seed' => (int) $m['seed'], 'level' => $m['level'], 'host' => $m['host_id'] == uid()]);
}

if ($action === 'gstart') {
  $code = strtoupper(trim(body()['code'] ?? ''));
  $m = mByCode($pdo, $code);
  if (!$m || $m['mode'] !== 'group') out(['error' => 'Group not found.'], 404);
  if ($m['host_id'] != uid()) out(['error' => 'Only the host can start the game.'], 403);
  $cnt = $pdo->prepare('SELECT COUNT(*) FROM match_players WHERE match_id = ?'); $cnt->execute([$m['id']]);
  if ((int) $cnt->fetchColumn() < GROUP_MIN) out(['error' => 'Need at least ' . GROUP_MIN . ' players to start.'], 400);
  $pdo->prepare('UPDATE matches SET status = "playing" WHERE id = ?')->execute([$m['id']]);
  out(['ok' => true]);
}

if ($action === 'gsubmit') {
  $b = body(); $code = strtoupper(trim($b['code'] ?? '')); $score = (int) ($b['score'] ?? 0);
  $m = mByCode($pdo, $code);
  if (!$m) out(['error' => 'Group not found.'], 404);
  $pdo->prepare('UPDATE match_players SET score = ?, done = 1 WHERE match_id = ? AND user_id = ?')->execute([$score, $m['id'], uid()]);
  out(['ok' => true]);
}

if ($action === 'globby') {
  $code = strtoupper(trim($_GET['code'] ?? (body()['code'] ?? '')));
  $m = mByCode($pdo, $code);
  if (!$m || $m['mode'] !== 'group') out(['error' => 'Group not found.'], 404);
  $players = groupPlayers($pdo, $m['id']);
  $allDone = count($players) > 0 && !array_filter($players, fn($p) => !$p['done']);
  if ($m['status'] === 'playing' && $allDone) { $pdo->prepare('UPDATE matches SET status = "done" WHERE id = ?')->execute([$m['id']]); $m['status'] = 'done'; }
  $ranking = $players;
  usort($ranking, fn($a, $b) => $b['score'] - $a['score']);        // highest score wins
  out([
    'code' => $code, 'seed' => (int) $m['seed'], 'level' => $m['level'],
    'status' => $m['status'], 'host' => $m['host_id'] == uid(), 'you' => (int) uid(),
    'count' => count($players), 'min' => GROUP_MIN, 'max' => GROUP_MAX,
    'players' => $players, 'ranking' => $ranking, 'allDone' => $allDone,
  ]);
}

out(['error' => 'Unknown action'], 400);
