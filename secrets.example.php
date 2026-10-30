<?php
// ============================================================================
//  secrets.example.php  —  TEMPLATE (safe to share; contains NO real keys)
// ----------------------------------------------------------------------------
//  Copy this to:   ~/domains/.rogeratc-data/secrets.php   on the server
//  (that folder is OUTSIDE public_html, so it is never web-served or committed),
//  then fill in the real values and:   chmod 600 secrets.php
// ============================================================================
return [
  // ---- Stripe (payments / subscriptions) ----
  // Dashboard -> Developers -> API keys. Use the TEST keys while testing,
  // the LIVE keys when going live.
  'stripe_secret'  => 'YOUR_STRIPE_SECRET_KEY',
  'stripe_pub'     => 'YOUR_STRIPE_PUBLISHABLE_KEY',   // sent to the browser
  // Dashboard -> Developers -> Webhooks -> (endpoint /api/webhook.php) -> Signing secret
  'stripe_webhook' => 'YOUR_STRIPE_WEBHOOK_SIGNING_SECRET',

  // ---- Google Sign-In ----
  // Google Cloud Console -> APIs & Services -> Credentials -> OAuth 2.0 Client ID.
  // Add your site origins to "Authorized JavaScript origins".
  'google_client_id' => 'YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com',
];
