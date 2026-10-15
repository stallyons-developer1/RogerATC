<?php
// RogerATC payments — Square subscriptions (Customer → Card-on-file → Subscription).
// Sandbox or production is chosen by secrets()['square_env'].
require __DIR__ . '/db.php';
require __DIR__ . '/config.php';

session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
]);
session_start();

function out($d, $c = 200) { http_response_code($c); header('Content-Type: application/json'); echo json_encode($d); exit; }
function body() { $j = json_decode(file_get_contents('php://input'), true); return is_array($j) ? $j : $_POST; }
function uid() { return $_SESSION['uid'] ?? null; }
function rid() { return bin2hex(random_bytes(16)); }                 // Square idempotency key
function sqErr($r, $fallback) { $e = $r['errors'][0] ?? null; return $e ? ($e['detail'] ?? ($e['code'] ?? $fallback)) : $fallback; }

function sq($method, $path, $bodyArr = null) {
  $s = secrets();
  $base = (($s['square_env'] ?? 'sandbox') === 'production') ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  $ch = curl_init($base . '/v2/' . $path);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    'Authorization: Bearer ' . ($s['square_token'] ?? ''),
    'Square-Version: 2025-01-23',
    'Content-Type: application/json',
  ]);
  if ($method !== 'GET') { curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method); if ($bodyArr !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($bodyArr)); }
  curl_setopt($ch, CURLOPT_TIMEOUT, 25);
  $res = curl_exec($ch); $code = curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
  return [$code, json_decode($res, true) ?: []];
}

$pdo = db();
$action = $_GET['action'] ?? (body()['action'] ?? '');
if (!uid()) out(['error' => 'Please log in first.'], 401);

$PLANS = [
  'multiplayer' => ['name' => 'RogerATC Multiplayer', 'col' => 'sub_multiplayer'],
  'adfree'      => ['name' => 'RogerATC Ad-Free',     'col' => 'sub_adfree'],
  'runad'       => ['name' => 'RogerATC Run an Ad',   'col' => 'sub_runad'],
];

// Create a Square subscription from a Web-Payments-SDK card token.
if ($action === 'subscribe') {
  $plan   = body()['plan'] ?? '';
  $source = body()['source_id'] ?? '';                               // card nonce from the SDK
  $verif  = body()['verification_token'] ?? null;                    // SCA/3DS token (optional)
  if (!isset($PLANS[$plan])) out(['error' => 'Unknown plan'], 400);
  if (!$source) out(['error' => 'No card details'], 400);

  $s = secrets();
  $planVar = $s['square_plans'][$plan] ?? '';
  $loc     = $s['square_location'] ?? '';
  if (!$planVar || !$loc || empty($s['square_token'])) out(['error' => 'Square is not configured yet.'], 500);

  // 1) Customer (reuse if we already made one for this user)
  $q = $pdo->prepare('SELECT square_customer, email FROM users WHERE id = ?'); $q->execute([uid()]);
  $u = $q->fetch(PDO::FETCH_ASSOC);
  $custId = $u['square_customer'] ?? '';
  if (!$custId) {
    [$cc, $cr] = sq('POST', 'customers', ['idempotency_key' => rid(), 'email_address' => $u['email'] ?? null, 'reference_id' => (string) uid()]);
    $custId = $cr['customer']['id'] ?? '';
    if (!$custId) out(['error' => sqErr($cr, 'Could not create your Square customer profile.')], 500);
    $pdo->prepare('UPDATE users SET square_customer = ? WHERE id = ?')->execute([$custId, uid()]);
  }

  // 2) Save the card on file (this also validates the card)
  $cardBody = ['idempotency_key' => rid(), 'source_id' => $source, 'card' => ['customer_id' => $custId]];
  if ($verif) $cardBody['verification_token'] = $verif;
  [$dc, $dr] = sq('POST', 'cards', $cardBody);
  $cardId = $dr['card']['id'] ?? '';
  if (!$cardId) {
    $m = sqErr($dr, 'your card could not be saved');
    setPay($pdo, uid(), 'failed', 'Payment failed: ' . $m . '. Please try another card.', 'square');
    out(['error' => $m], 402);
  }

  // 3) Create the subscription (charges per the monthly plan)
  [$bc, $br] = sq('POST', 'subscriptions', [
    'idempotency_key'   => rid(),
    'location_id'       => $loc,
    'plan_variation_id' => $planVar,
    'customer_id'       => $custId,
    'card_id'           => $cardId,
  ]);
  $sub = $br['subscription'] ?? null;
  if (!$sub) {
    $m = sqErr($br, 'could not start your subscription');
    setPay($pdo, uid(), 'failed', 'Payment failed: ' . $m . '.', 'square');
    out(['error' => $m], 402);
  }

  $pdo->prepare('UPDATE users SET ' . $PLANS[$plan]['col'] . ' = 1 WHERE id = ?')->execute([uid()]);
  setPay($pdo, uid(), 'active', 'Your ' . $PLANS[$plan]['name'] . ' subscription is active (via Square).', 'square');
  out(['ok' => true, 'plan' => $plan, 'status' => $sub['status'] ?? 'ACTIVE']);
}

out(['error' => 'Unknown action'], 400);
