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
  $col = $plan === 'adfree' ? 'sub_adfree' : ($plan === 'multiplayer' ? 'sub_multiplayer' : null);
  if ($col && $uid) $pdo->prepare("UPDATE users SET $col = ? WHERE id = ?")->execute([$val, (int) $uid]);
}

$uid  = (int) ($obj['metadata']['uid'] ?? 0);
$plan = $obj['metadata']['plan'] ?? '';
$status = $obj['status'] ?? '';

if ($type === 'customer.subscription.deleted') {
  setFlag($pdo, $uid, $plan, 0);                                   // canceled -> revoke
} elseif ($type === 'customer.subscription.updated') {
  setFlag($pdo, $uid, $plan, in_array($status, ['active', 'trialing']) ? 1 : 0);
} elseif ($type === 'invoice.payment_failed') {
  // optional: a failed renewal — Stripe will also send subscription.updated; revoke to be safe
  $sub = $obj['subscription'] ?? '';
  // metadata not on invoice; rely on subscription.updated event for the flag change
}

http_response_code(200);
echo 'ok';
