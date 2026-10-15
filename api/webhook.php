<?php
// RogerATC Stripe webhook — keeps subscription flags accurate (renew / cancel / expire).
require __DIR__ . '/db.php';
require __DIR__ . '/config.php';

$payload = file_get_contents('php://input');
$sig     = $_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '';
$whsec   = secrets()['stripe_webhook'] ?? '';

// Verify Stripe signature (t=timestamp,v1=hmac). Returns true/false, or null if not configured.
function verifySig($payload, $sigHeader, $secret) {
  if (!$secret) return null;
  $parts = [];
  foreach (explode(',', $sigHeader) as $kv) {
    $p = explode('=', $kv, 2);
    if (count($p) === 2) $parts[$p[0]][] = $p[1];
  }
  $t = $parts['t'][0] ?? '';
  if (!$t || abs(time() - (int) $t) > 300) return false;          // 5-min replay window
  $expected = hash_hmac('sha256', $t . '.' . $payload, $secret);
  foreach (($parts['v1'] ?? []) as $v) if (hash_equals($expected, $v)) return true;
  return false;
}

$ok = verifySig($payload, $sig, $whsec);
if ($ok !== true) { http_response_code(400); echo $ok === null ? 'webhook not configured' : 'bad signature'; exit; }

$event = json_decode($payload, true);
$type  = $event['type'] ?? '';
$obj   = $event['data']['object'] ?? [];
$pdo   = db();

function setFlag($pdo, $uid, $plan, $val) {
  $col = $plan === 'adfree' ? 'sub_adfree' : ($plan === 'multiplayer' ? 'sub_multiplayer' : ($plan === 'runad' ? 'sub_runad' : null));
  if ($col && $uid) $pdo->prepare("UPDATE users SET $col = ? WHERE id = ?")->execute([$val, (int) $uid]);
}
// Minimal Stripe GET — used to fetch the EXACT decline reason on a failed payment.
function stripeGet($path) {
  $sk = secrets()['stripe_secret'] ?? '';
  $ch = curl_init('https://api.stripe.com/v1/' . $path);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_USERPWD, $sk . ':');
  curl_setopt($ch, CURLOPT_TIMEOUT, 10);
  $res = curl_exec($ch); curl_close($ch);
  return json_decode($res, true) ?: [];
}
function uidByCustomer($pdo, $cust) {
  if (!$cust) return 0;
  $q = $pdo->prepare('SELECT id FROM users WHERE stripe_customer = ?'); $q->execute([$cust]);
  return (int) ($q->fetchColumn() ?: 0);
}

$uid    = (int) ($obj['metadata']['uid'] ?? 0);
$plan   = $obj['metadata']['plan'] ?? '';
$status = $obj['status'] ?? '';
$PLAN_NAMES = ['multiplayer' => 'Multiplayer', 'adfree' => 'Ad-Free', 'runad' => 'Run an Ad'];
$pname  = $PLAN_NAMES[$plan] ?? 'subscription';

if ($type === 'checkout.session.completed') {
  if ($uid && $plan) {
    setFlag($pdo, $uid, $plan, 1);
    if (!empty($obj['customer'])) $pdo->prepare('UPDATE users SET stripe_customer = ? WHERE id = ?')->execute([$obj['customer'], $uid]);
    setPay($pdo, $uid, 'active', "Your $pname subscription is active.", 'stripe');
  }
} elseif ($type === 'customer.subscription.deleted') {
  setFlag($pdo, $uid, $plan, 0);
  setPay($pdo, $uid, 'canceled', "Your $pname subscription has been canceled.", 'stripe');
} elseif ($type === 'customer.subscription.updated') {
  if (in_array($status, ['active', 'trialing'])) {
    setFlag($pdo, $uid, $plan, 1);
    setPay($pdo, $uid, 'active', "Your $pname subscription is active.", 'stripe');
  } elseif ($status === 'past_due') {
    // keep access during Stripe's retry window, but warn the player
    setPay($pdo, $uid, 'past_due', "Your last $pname payment failed — update your card to keep your subscription.", 'stripe');
  } else {                                                          // unpaid / incomplete_expired / canceled
    setFlag($pdo, $uid, $plan, 0);
    setPay($pdo, $uid, 'inactive', "Your $pname subscription is no longer active.", 'stripe');
  }
} elseif ($type === 'invoice.payment_failed') {
  $u = $uid ?: uidByCustomer($pdo, $obj['customer'] ?? '');         // invoices carry no metadata → map by customer
  $reason = 'your card was declined';
  $piId = $obj['payment_intent'] ?? '';
  if ($piId) {                                                      // fetch the exact decline message
    $m = stripeGet('payment_intents/' . urlencode($piId))['last_payment_error']['message'] ?? '';
    if ($m) $reason = rtrim($m, '.');
  }
  if ($u) setPay($pdo, $u, 'failed', 'Payment failed: ' . $reason . '. Please update your card.', 'stripe');
}

http_response_code(200);
echo 'ok';
