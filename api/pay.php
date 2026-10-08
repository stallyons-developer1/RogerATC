<?php
// RogerATC payments — Stripe Checkout subscriptions ($4.99 multiplayer, $24.99 ad-free).
require __DIR__ . '/db.php';
require __DIR__ . '/config.php';

session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
]);
session_start();

function out($d, $c = 200) { http_response_code($c); header('Content-Type: application/json'); echo json_encode($d); exit; }
function body() { $j = json_decode(file_get_contents('php://input'), true); return is_array($j) ? $j : $_POST; }
function uid() { return $_SESSION['uid'] ?? null; }

function stripe($method, $path, $params = null) {
  $sk = secrets()['stripe_secret'] ?? '';
  $ch = curl_init('https://api.stripe.com/v1/' . $path);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_USERPWD, $sk . ':');
  if ($method === 'POST') { curl_setopt($ch, CURLOPT_POST, true); curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($params)); }
  $res = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  return [$code, json_decode($res, true)];
}

$pdo = db();
$action = $_GET['action'] ?? (body()['action'] ?? '');
if (!uid()) out(['error' => 'Please log in first.'], 401);

$PLANS = [
  'multiplayer' => ['name' => 'RogerATC Multiplayer', 'amount' => 499,  'col' => 'sub_multiplayer'],
  'adfree'      => ['name' => 'RogerATC Ad-Free',     'amount' => 2499, 'col' => 'sub_adfree'],
];

if ($action === 'checkout') {
  $plan = body()['plan'] ?? '';
  if (!isset($PLANS[$plan])) out(['error' => 'Unknown plan'], 400);
  $p = $PLANS[$plan];
  $base = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . $_SERVER['HTTP_HOST'] . preg_replace('#/api/.*#', '', $_SERVER['REQUEST_URI']);
  $params = [
    'mode' => 'subscription',
    'line_items[0][quantity]' => 1,
    'line_items[0][price_data][currency]' => 'usd',
    'line_items[0][price_data][unit_amount]' => $p['amount'],
    'line_items[0][price_data][recurring][interval]' => 'month',
    'line_items[0][price_data][product_data][name]' => $p['name'],
    'success_url' => $base . '/?pay=success&session_id={CHECKOUT_SESSION_ID}',
    'cancel_url'  => $base . '/?pay=cancel',
    'client_reference_id' => (string) uid(),
    'metadata[plan]' => $plan,
    'metadata[uid]'  => (string) uid(),
    'subscription_data[metadata][plan]' => $plan,   // carried on the subscription for webhooks
    'subscription_data[metadata][uid]'  => (string) uid(),
  ];
  [$code, $sess] = stripe('POST', 'checkout/sessions', $params);
  if ($code >= 300 || !isset($sess['url'])) out(['error' => 'Stripe: ' . ($sess['error']['message'] ?? 'error')], 500);
  out(['ok' => true, 'url' => $sess['url']]);
}

if ($action === 'confirm') {
  $sid = $_GET['session_id'] ?? (body()['session_id'] ?? '');
  if (!$sid) out(['error' => 'No session'], 400);
  [$code, $sess] = stripe('GET', 'checkout/sessions/' . urlencode($sid));
  if ($code >= 300 || !$sess) out(['error' => 'Could not verify payment'], 500);
  $paid = ($sess['payment_status'] ?? '') === 'paid' || ($sess['status'] ?? '') === 'complete';
  $plan = $sess['metadata']['plan'] ?? '';
  $suid = (int) ($sess['metadata']['uid'] ?? 0);
  if ($paid && isset($PLANS[$plan]) && $suid === (int) uid()) {
    $pdo->prepare('UPDATE users SET ' . $PLANS[$plan]['col'] . ' = 1 WHERE id = ?')->execute([uid()]);
    out(['ok' => true, 'plan' => $plan]);
  }
  out(['error' => 'Payment not completed'], 402);
}

if ($action === 'status') {
  $q = $pdo->prepare('SELECT sub_multiplayer, sub_adfree FROM users WHERE id = ?'); $q->execute([uid()]);
  $u = $q->fetch(PDO::FETCH_ASSOC);
  out(['sub_multiplayer' => (bool) $u['sub_multiplayer'], 'sub_adfree' => (bool) $u['sub_adfree']]);
}

out(['error' => 'Unknown action'], 400);
