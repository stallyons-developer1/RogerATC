<?php
// RogerATC auth API — email signup/login with verification, sessions, high-score sync.
require __DIR__ . '/db.php';
require __DIR__ . '/config.php';

session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 30,
  'path'     => '/',
  'secure'   => true,
  'httponly' => true,
  'samesite' => 'Lax',
]);
session_start();

function out($data, $code = 200) {
  http_response_code($code);
  header('Content-Type: application/json');
  echo json_encode($data);
  exit;
}
function body() {
  $j = json_decode(file_get_contents('php://input'), true);
  return is_array($j) ? $j : $_POST;
}
function publicUser($u) {
  return [
    'email'      => $u['email'],
    'verified'   => (bool) $u['verified'],
    'callsign'   => $u['callsign'],
    'high_score' => (int) $u['high_score'],
    'provider'   => $u['provider'] ?? 'email',
  ];
}

$pdo    = db();
$action = $_GET['action'] ?? (body()['action'] ?? '');

// ---------- SIGN UP ----------
if ($action === 'signup') {
  $b     = body();
  $email = strtolower(trim($b['email'] ?? ''));
  $pass  = (string) ($b['password'] ?? '');
  if (!filter_var($email, FILTER_VALIDATE_EMAIL)) out(['error' => 'Please enter a valid email.'], 400);
  if (strlen($pass) < 6) out(['error' => 'Password must be at least 6 characters.'], 400);

  $chk = $pdo->prepare('SELECT id FROM users WHERE email = ?');
  $chk->execute([$email]);
  if ($chk->fetch()) out(['error' => 'This email is already registered. Try logging in.'], 409);

  $token = bin2hex(random_bytes(16));
  $ins = $pdo->prepare('INSERT INTO users (email, pass_hash, verify_token) VALUES (?, ?, ?)');
  $ins->execute([$email, password_hash($pass, PASSWORD_DEFAULT), $token]);
  $uid = (int) $pdo->lastInsertId();

  // verification email
  $base = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . dirname($_SERVER['REQUEST_URI']);
  $link = $base . '/auth.php?action=verify&token=' . $token;
  @mail(
    $email,
    'Verify your RogerATC account',
    "Welcome to RogerATC!\n\nVerify your email by opening this link:\n$link\n\nThen hop back in and fly. ✈️",
    "From: no-reply@" . $_SERVER['HTTP_HOST'] . "\r\n"
  );

  $_SESSION['uid'] = $uid;
  out(['ok' => true, 'user' => ['email' => $email, 'verified' => false, 'provider' => 'email', 'high_score' => 0, 'callsign' => null],
       'message' => 'Account created — check your email to verify.']);
}

// ---------- LOG IN ----------
if ($action === 'login') {
  $b     = body();
  $email = strtolower(trim($b['email'] ?? ''));
  $pass  = (string) ($b['password'] ?? '');
  $stmt  = $pdo->prepare('SELECT * FROM users WHERE email = ?');
  $stmt->execute([$email]);
  $u = $stmt->fetch(PDO::FETCH_ASSOC);
  if (!$u || !$u['pass_hash'] || !password_verify($pass, $u['pass_hash'])) {
    out(['error' => 'Wrong email or password.'], 401);
  }
  $_SESSION['uid'] = (int) $u['id'];
  out(['ok' => true, 'user' => publicUser($u)]);
}

// ---------- GOOGLE SIGN-IN (verify GIS ID token) ----------
if ($action === 'google') {
  $cred = body()['credential'] ?? '';
  if (!$cred) out(['error' => 'No Google credential received.'], 400);
  $resp = @file_get_contents('https://oauth2.googleapis.com/tokeninfo?id_token=' . urlencode($cred));
  if (!$resp) out(['error' => 'Could not verify with Google.'], 401);
  $info = json_decode($resp, true);
  $cid  = secrets()['google_client_id'] ?? '';
  if (!$info || !isset($info['aud']) || $info['aud'] !== $cid) out(['error' => 'Invalid Google token.'], 401);
  $email = strtolower($info['email'] ?? '');
  if (!$email) out(['error' => 'Google account has no email.'], 401);
  $q = $pdo->prepare('SELECT * FROM users WHERE email = ?'); $q->execute([$email]);
  $u = $q->fetch(PDO::FETCH_ASSOC);
  if (!$u) {
    $pdo->prepare('INSERT INTO users (email, provider, verified) VALUES (?, "google", 1)')->execute([$email]);
    $q->execute([$email]); $u = $q->fetch(PDO::FETCH_ASSOC);
  }
  $_SESSION['uid'] = (int) $u['id'];
  out(['ok' => true, 'user' => publicUser($u)]);
}

// ---------- VERIFY EMAIL (link from the email) ----------
if ($action === 'verify') {
  $token = $_GET['token'] ?? '';
  $stmt  = $pdo->prepare('UPDATE users SET verified = 1, verify_token = NULL WHERE verify_token = ?');
  $stmt->execute([$token]);
  $ok = $stmt->rowCount() > 0;
  header('Content-Type: text/html; charset=utf-8');
  echo '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'
     . '<body style="font-family:system-ui;background:#2a1550;color:#fff;display:grid;place-items:center;height:100vh;margin:0;text-align:center">'
     . '<div><h1>' . ($ok ? '✅ Email verified!' : '⚠️ Invalid or expired link') . '</h1>'
     . '<p>' . ($ok ? 'You can close this tab and return to RogerATC.' : 'Please sign up again.') . '</p>'
     . '<a style="color:#ffd166" href="../index.html">← Back to RogerATC</a></div>';
  exit;
}

// ---------- CURRENT USER ----------
if ($action === 'me') {
  if (empty($_SESSION['uid'])) out(['user' => null]);
  $stmt = $pdo->prepare('SELECT * FROM users WHERE id = ?');
  $stmt->execute([$_SESSION['uid']]);
  $u = $stmt->fetch(PDO::FETCH_ASSOC);
  out(['user' => $u ? publicUser($u) : null]);
}

// ---------- LOG OUT ----------
if ($action === 'logout') {
  $_SESSION = [];
  session_destroy();
  out(['ok' => true]);
}

// ---------- SAVE HIGH SCORE ----------
if ($action === 'savescore') {
  if (empty($_SESSION['uid'])) out(['error' => 'Not logged in'], 401);
  $b = body();
  $score = (int) ($b['score'] ?? 0);
  $cs = isset($b['callsign']) && $b['callsign'] ? substr(trim($b['callsign']), 0, 40) : null;
  if ($cs) $pdo->prepare('UPDATE users SET callsign = ? WHERE id = ?')->execute([$cs, $_SESSION['uid']]);
  $pdo->prepare('UPDATE users SET high_score = MAX(high_score, ?) WHERE id = ?')
      ->execute([$score, $_SESSION['uid']]);
  out(['ok' => true]);
}

// ---------- LEADERBOARD ----------
if ($action === 'leaderboard') {
  $rows = $pdo->query('SELECT email, callsign, high_score FROM users WHERE high_score > 0
                       ORDER BY high_score DESC, id ASC LIMIT 20')->fetchAll(PDO::FETCH_ASSOC);
  $top = array_map(function ($r) {
    return ['name' => $r['callsign'] ?: explode('@', $r['email'])[0], 'score' => (int) $r['high_score']];
  }, $rows);
  $me = null;
  if (!empty($_SESSION['uid'])) {
    $q = $pdo->prepare('SELECT high_score FROM users WHERE id = ?');
    $q->execute([$_SESSION['uid']]);
    $hs = (int) $q->fetchColumn();
    $r = $pdo->prepare('SELECT COUNT(*) + 1 FROM users WHERE high_score > ?');
    $r->execute([$hs]);
    $me = ['rank' => (int) $r->fetchColumn(), 'score' => $hs];
  }
  out(['top' => $top, 'me' => $me]);
}

out(['error' => 'Unknown action'], 400);
