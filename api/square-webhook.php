<?php
// RogerATC Square webhook — keeps subscription flags + payment status accurate
// (payment made / charge failed / canceled). Verifies Square's HMAC-SHA256 signature.
require __DIR__ . '/db.php';
require __DIR__ . '/config.php';

$payload = file_get_contents('php://input');
$sig     = $_SERVER['HTTP_X_SQUARE_HMACSHA256_SIGNATURE'] ?? '';
$s       = secrets();
$key     = $s['square_webhook'] ?? '';
if (!$key) { http_response_code(400); echo 'not configured'; exit; }

// Square signs base64( HMAC-SHA256( notificationURL + body ) ). URL must match the one set in Square.
$url = (isset($_SERVER['HTTPS']) ? 'https' : 'http') . '://' . ($_SERVER['HTTP_HOST'] ?? '') . ($_SERVER['REQUEST_URI'] ?? '');
$expected = base64_encode(hash_hmac('sha256', $url . $payload, $key, true));
if (!hash_equals($expected, $sig)) { http_response_code(400); echo 'bad signature'; exit; }

$event = json_decode($payload, true);
$type  = $event['type'] ?? '';
$obj   = $event['data']['object'] ?? [];
$pdo   = db();

function uidByCustomer($pdo, $cust) {
  if (!$cust) return 0;
  $q = $pdo->prepare('SELECT id FROM users WHERE square_customer = ?'); $q->execute([$cust]);
  return (int) ($q->fetchColumn() ?: 0);
}

$inv  = $obj['invoice'] ?? null;
$sub  = $obj['subscription'] ?? null;
$cust = ($inv['primary_recipient']['customer_id'] ?? '') ?: ($sub['customer_id'] ?? '') ?: ($inv['customer_id'] ?? '');
$u    = uidByCustomer($pdo, $cust);

$planByVar = array_flip($s['square_plans'] ?? []);              // variation_id => plan key
$cols = ['multiplayer' => 'sub_multiplayer', 'adfree' => 'sub_adfree', 'runad' => 'sub_runad'];

if ($type === 'invoice.payment_made') {
  if ($u) setPay($pdo, $u, 'active', 'Your subscription payment went through — thank you!', 'square');
} elseif ($type === 'invoice.scheduled_charge_failed' || $type === 'invoice.payment_failed') {
  // keep access during Square's retry window, but warn the player
  if ($u) setPay($pdo, $u, 'past_due', 'Your last payment failed — please update your card to keep your subscription.', 'square');
} elseif ($type === 'subscription.updated') {
  $st  = strtoupper($sub['status'] ?? '');
  $col = $cols[$planByVar[$sub['plan_variation_id'] ?? ''] ?? ''] ?? null;
  if (in_array($st, ['CANCELED', 'DEACTIVATED'])) {
    if ($u && $col) $pdo->prepare("UPDATE users SET $col = 0 WHERE id = ?")->execute([$u]);
    if ($u) setPay($pdo, $u, 'canceled', 'Your subscription has been canceled.', 'square');
  } elseif ($st === 'ACTIVE') {
    if ($u && $col) $pdo->prepare("UPDATE users SET $col = 1 WHERE id = ?")->execute([$u]);
  }
}

http_response_code(200);
echo 'ok';
