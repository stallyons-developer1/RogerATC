<?php
// ============================================================================
//  square.example.php  —  TEMPLATE (safe to share; contains NO real keys)
// ----------------------------------------------------------------------------
//  Copy this to:   ~/domains/.rogeratc-data/square.php   on the server
//  and fill in the real values. Kept separate from secrets.php so Square can
//  be added/swapped without touching the main secrets. (chmod 600)
//  Leave 'square_enabled' => false to run with Stripe only.
// ============================================================================
return [
  'square_enabled'  => false,                     // true to turn Square on
  'square_env'      => 'sandbox',                 // 'sandbox' (testing) | 'production' (live)
  'square_app_id'   => 'YOUR_SQUARE_APPLICATION_ID',  // Developer Dashboard -> your app -> Application ID
  'square_location' => 'YOUR_SQUARE_LOCATION_ID',     // your Square Location ID
  'square_token'    => 'YOUR_SQUARE_ACCESS_TOKEN',    // Access Token (sandbox or production)
  'square_webhook'  => 'YOUR_SQUARE_WEBHOOK_SIGNATURE_KEY', // for /api/square-webhook.php
  'square_plans'    => [                           // Catalog subscription-plan variation IDs (optional)
    'multiplayer' => '',
    'adfree'      => '',
    'runad'       => '',
  ],
];
