<?php
// Reads secret keys from OUTSIDE the web root (never in git / never web-served).
function secrets() {
  static $s = null;
  if ($s !== null) return $s;
  $f = __DIR__ . '/../../../.rogeratc-data/secrets.php';
  $s = is_file($f) ? (require $f) : [];
  return $s;
}
