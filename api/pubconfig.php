<?php
// PUBLIC config for the frontend (publishable key + Google client id — safe to expose).
require __DIR__ . '/config.php';
header('Content-Type: application/json');
$s = secrets();
echo json_encode([
  'stripe_pub'       => $s['stripe_pub'] ?? '',
  'google_client_id' => $s['google_client_id'] ?? '',
]);
