<?php
// RogerATC "Run an Ad" — advertisers (sub_runad) upload an image/video that plays
// directly in the ad slots to non-ad-free players. No admin review (per client).
require __DIR__ . '/db.php';

session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
]);
session_start();

function out($d, $c = 200) { http_response_code($c); header('Content-Type: application/json'); echo json_encode($d); exit; }
function uid() { return $_SESSION['uid'] ?? null; }

$pdo = db();
$action = $_GET['action'] ?? ($_POST['action'] ?? '');

// web + filesystem paths for the uploaded media (under the app root, so it's publicly viewable)
$UP_DIR = __DIR__ . '/../uploads/ads';
$UP_WEB = 'uploads/ads';
$EXT = [
  'image/jpeg' => ['image', 'jpg'], 'image/png' => ['image', 'png'],
  'image/webp' => ['image', 'webp'], 'image/gif' => ['image', 'gif'],
  'video/mp4'  => ['video', 'mp4'], 'video/webm' => ['video', 'webm'],
];
$MAX = 20 * 1024 * 1024;   // 20 MB

// ---- active ads (PUBLIC): advertisers with a live subscription + an uploaded creative ----
if ($action === 'active') {
  $rows = $pdo->query('SELECT a.media, a.type, a.url FROM ads a
                       JOIN users u ON u.id = a.user_id
                       WHERE u.sub_runad = 1')->fetchAll(PDO::FETCH_ASSOC);
  $ads = array_map(fn($r) => [
    'src' => $UP_WEB . '/' . $r['media'], 'type' => $r['type'], 'url' => $r['url'] ?: '',
  ], $rows);
  out(['ads' => $ads]);
}

// everything below needs a logged-in advertiser
if (!uid()) out(['error' => 'Please log in first.'], 401);
$me = $pdo->prepare('SELECT sub_runad FROM users WHERE id = ?'); $me->execute([uid()]);
$sub = (bool) ($me->fetchColumn());

if ($action === 'mine') {
  $q = $pdo->prepare('SELECT media, type, url FROM ads WHERE user_id = ?'); $q->execute([uid()]);
  $r = $q->fetch(PDO::FETCH_ASSOC);
  out(['sub_runad' => $sub, 'ad' => $r ? ['src' => $UP_WEB . '/' . $r['media'], 'type' => $r['type'], 'url' => $r['url']] : null]);
}

if ($action === 'upload') {
  if (!$sub) out(['error' => 'A "Run an Ad" subscription is required.'], 403);
  if (empty($_FILES['media']) || $_FILES['media']['error'] !== UPLOAD_ERR_OK) out(['error' => 'No file uploaded (max 20 MB).'], 400);
  $f = $_FILES['media'];
  if ($f['size'] > $MAX) out(['error' => 'File too large (max 20 MB).'], 400);
  $mime = mime_content_type($f['tmp_name']);
  if (!isset($EXT[$mime])) out(['error' => 'Only JPG, PNG, WEBP, GIF, MP4 or WEBM allowed.'], 400);
  [$type, $ext] = $EXT[$mime];

  $url = trim($_POST['url'] ?? '');
  if ($url !== '' && !preg_match('#^https?://#i', $url)) $url = 'https://' . $url;
  if ($url !== '' && !filter_var($url, FILTER_VALIDATE_URL)) out(['error' => 'Invalid click-through URL.'], 400);

  if (!is_dir($UP_DIR)) @mkdir($UP_DIR, 0755, true);
  // remove any previous creative for this advertiser (one active ad each)
  foreach (glob($UP_DIR . '/ad_' . uid() . '.*') as $old) @unlink($old);
  $name = 'ad_' . uid() . '.' . $ext;
  if (!move_uploaded_file($f['tmp_name'], $UP_DIR . '/' . $name)) out(['error' => 'Could not save the file.'], 500);

  $pdo->prepare('INSERT INTO ads (user_id, media, type, url, updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
                 ON CONFLICT(user_id) DO UPDATE SET media=excluded.media, type=excluded.type, url=excluded.url, updated_at=CURRENT_TIMESTAMP')
      ->execute([uid(), $name, $type, $url]);
  out(['ok' => true, 'ad' => ['src' => $UP_WEB . '/' . $name, 'type' => $type, 'url' => $url]]);
}

out(['error' => 'Unknown action'], 400);
