<?php
// RogerATC messaging — player list with presence, send, conversation.
require __DIR__ . '/db.php';
session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
]);
session_start();

function out($d, $c = 200) { http_response_code($c); header('Content-Type: application/json'); echo json_encode($d); exit; }
function body() { $j = json_decode(file_get_contents('php://input'), true); return is_array($j) ? $j : $_POST; }
function uid() { return $_SESSION['uid'] ?? null; }
function nameOf($r) { return $r['callsign'] ?: explode('@', $r['email'])[0]; }
function isOnline($ls) { return $ls && strtotime($ls . ' UTC') > time() - 65; }

$pdo = db();
$action = $_GET['action'] ?? (body()['action'] ?? '');
if (!uid()) out(['error' => 'Please log in.'], 401);

// presence heartbeat on every call
$pdo->prepare('UPDATE users SET last_seen = CURRENT_TIMESTAMP WHERE id = ?')->execute([uid()]);

if ($action === 'ping') out(['ok' => true]);

if ($action === 'players') {
  $rows = $pdo->prepare('SELECT id, email, callsign, last_seen FROM users WHERE id != ? ORDER BY last_seen DESC LIMIT 60');
  $rows->execute([uid()]);
  $players = array_map(function ($r) {
    return ['id' => (int) $r['id'], 'name' => nameOf($r), 'online' => isOnline($r['last_seen'])];
  }, $rows->fetchAll(PDO::FETCH_ASSOC));
  out(['players' => $players]);
}

if ($action === 'send') {
  $b = body(); $to = (int) ($b['to'] ?? 0); $msg = trim((string) ($b['body'] ?? ''));
  if (!$to || $msg === '') out(['error' => 'Empty message.'], 400);
  if (mb_strlen($msg) > 500) $msg = mb_substr($msg, 0, 500);
  $chk = $pdo->prepare('SELECT 1 FROM users WHERE id = ?'); $chk->execute([$to]);
  if (!$chk->fetch()) out(['error' => 'User not found.'], 404);
  $pdo->prepare('INSERT INTO messages (from_id, to_id, body) VALUES (?,?,?)')->execute([uid(), $to, $msg]);
  out(['ok' => true]);
}

if ($action === 'conversation') {
  $with = (int) ($_GET['with'] ?? (body()['with'] ?? 0));
  if (!$with) out(['error' => 'No user.'], 400);
  $stmt = $pdo->prepare('SELECT from_id, body, created_at FROM messages
    WHERE (from_id = ? AND to_id = ?) OR (from_id = ? AND to_id = ?) ORDER BY id ASC LIMIT 200');
  $stmt->execute([uid(), $with, $with, uid()]);
  $me = (int) uid();
  $msgs = array_map(function ($m) use ($me) {
    return ['mine' => (int) $m['from_id'] === $me, 'body' => $m['body'], 'at' => $m['created_at']];
  }, $stmt->fetchAll(PDO::FETCH_ASSOC));
  $q = $pdo->prepare('SELECT email, callsign, last_seen FROM users WHERE id = ?'); $q->execute([$with]);
  $u = $q->fetch(PDO::FETCH_ASSOC);
  out(['messages' => $msgs, 'name' => $u ? nameOf($u) : 'Player', 'online' => $u ? isOnline($u['last_seen']) : false]);
}

out(['error' => 'Unknown action'], 400);
