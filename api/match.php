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

out(['error' => 'Unknown action'], 400);
