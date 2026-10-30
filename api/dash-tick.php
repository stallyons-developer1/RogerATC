<?php
// Dash Contest housekeeping for cron. Closes expired lobbies and ends overdue contests.
// Hostinger cron (every minute), either:
//   */1 * * * *  php ~/domains/rogeratc.com/public_html/api/dash-tick.php
//   */1 * * * *  curl -s https://rogeratc.com/api/dash.php?action=tick
// The Dash pages also tick on visit, so this is a backstop for hosts without cron.
$_GET['action'] = 'tick';
require __DIR__ . '/dash.php';
