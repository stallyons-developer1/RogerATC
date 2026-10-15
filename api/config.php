<?php
// Reads secret keys from OUTSIDE the web root (never in git / never web-served).
function secrets() {
  static $s = null;
  if ($s !== null) return $s;
  $dir = __DIR__ . '/../../../.rogeratc-data';
  $s = is_file("$dir/secrets.php") ? (require "$dir/secrets.php") : [];
  // Square config lives in its own file so it can be added/swapped without touching the main secrets.
  if (is_file("$dir/square.php")) $s = array_merge($s, (array) (require "$dir/square.php"));
  return $s;
}
