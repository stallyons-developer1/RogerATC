<?php
// PUBLIC config for the frontend (publishable key + Google client id — safe to expose).
require __DIR__ . '/config.php';
header('Content-Type: application/json');
$s = secrets();
echo json_encode([
  'stripe_pub'       => $s['stripe_pub'] ?? '',
  'google_client_id' => $s['google_client_id'] ?? '',
  // Square Web Payments SDK needs the app id + location + env in the browser (all public)
  'square_enabled'   => !empty($s['square_app_id']) && !empty($s['square_location']),
  'square_app_id'    => $s['square_app_id'] ?? '',
  'square_location'  => $s['square_location'] ?? '',
  'square_env'       => $s['square_env'] ?? 'sandbox',
]);
