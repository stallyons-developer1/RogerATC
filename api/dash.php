<?php
// RogerATC — Dash Contests.
// Best of N seeded flights, 10-21 players; everyone flies the SAME courses (shared seed).
// Ranking: most flights SURVIVED (the ratio); tiebreak = higher total score.
// Phase 1 = free entry (no money). Wallet / entry fee / prizes come in Phase 2.

require __DIR__ . '/db.php';

session_set_cookie_params([
  'lifetime' => 60 * 60 * 24 * 30, 'path' => '/', 'secure' => true, 'httponly' => true, 'samesite' => 'Lax',
]);
session_start();

function out($d, $c = 200) { http_response_code($c); header('Content-Type: application/json'); echo json_encode($d); exit; }
function body() { $j = json_decode(file_get_contents('php://input'), true); return is_array($j) ? $j : $_POST; }
function uid() { return $_SESSION['uid'] ?? null; }
function nowMs() { return (int) round(microtime(true) * 1000); }
function uname($pdo, $id) {
  if (!$id) return null;
  $q = $pdo->prepare('SELECT email, callsign FROM users WHERE id = ?'); $q->execute([$id]);
  $u = $q->fetch(PDO::FETCH_ASSOC);
  return $u ? ($u['callsign'] ?: explode('@', $u['email'])[0]) : 'Pilot';
}

// ---- timing constants ----
const COUNTDOWN_MS    = 10000;   // after start, before the first flight
const PREVIEW_MS      = 1500;    // each flight is previewed this long before its clock starts
const GAP_MS          = 8000;    // time allowed between flights (result flash + load next)
const REPORT_GRACE_MS = 3000;    // a result may arrive this late, else it's a timeout
const STALE_START_MS  = 120000;  // an interrupted paid start is resumed after this (Phase 2)

// ---- settings (Phase 2 makes these admin-editable) ----
const DASH_MONEY     = false;    // Phase 1: all contests are free. Phase 2 flips this on.
const DASH_MATCHES   = 21;
const DASH_MIN       = 10;
const DASH_MAX       = 21;
const DASH_LOBBY_MIN = 30;       // lobby timeout (minutes)
const DASH_FLIGHT_MS = 25000;    // short dash flight (~25s)
const DASH_ENTRY_CENTS   = 2500; // $25 (Phase 2)
const DASH_PRIZES_CENTS  = [10000, 5000, 5000]; // $100 / $50 / $50 (Phase 2)
const SCORE_CAP      = 200000;   // reject absurd per-flight scores

function isBreeze() { return stripos($_SERVER['HTTP_HOST'] ?? '', 'breeze') !== false; }
// Phase 1 forces free everywhere; later: paid on RogerATC, free on Breeze.
function dashFree() { return !DASH_MONEY || isBreeze(); }

function dcode($pdo) {
  $a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  do { $s = ''; for ($i = 0; $i < 8; $i++) $s .= $a[random_int(0, strlen($a) - 1)];
       $c = $pdo->prepare('SELECT 1 FROM dash_contests WHERE code = ?'); $c->execute([$s]);
  } while ($c->fetch());
  return $s;
}
// The same flight for every player: one seed per flight, derived from the contest's seed.
function seedFor($seed, $n) { return (int) (((int) $seed + $n * 2654435761) % 4294967296); }

function dContest($pdo, $code) { $q = $pdo->prepare('SELECT * FROM dash_contests WHERE code = ?'); $q->execute([$code]); return $q->fetch(PDO::FETCH_ASSOC) ?: null; }
function dContestId($pdo, $id) { $q = $pdo->prepare('SELECT * FROM dash_contests WHERE id = ?'); $q->execute([$id]); return $q->fetch(PDO::FETCH_ASSOC) ?: null; }
function dEntry($pdo, $cid, $userId) { $q = $pdo->prepare('SELECT * FROM dash_entries WHERE dash_contest_id = ? AND user_id = ?'); $q->execute([$cid, $userId]); return $q->fetch(PDO::FETCH_ASSOC) ?: null; }
function dPlayers($pdo, $cid) { $q = $pdo->prepare('SELECT * FROM dash_entries WHERE dash_contest_id = ? AND status = "joined" ORDER BY joined_at ASC, id ASC'); $q->execute([$cid]); return $q->fetchAll(PDO::FETCH_ASSOC); }
function dPlayerCount($pdo, $cid) { $q = $pdo->prepare('SELECT COUNT(*) FROM dash_entries WHERE dash_contest_id = ? AND status = "joined"'); $q->execute([$cid]); return (int) $q->fetchColumn(); }

// Run a critical section inside a write lock (SQLite BEGIN IMMEDIATE serializes writers).
function dLocked($pdo, $cb) {
  $pdo->exec('BEGIN IMMEDIATE');
  try { $r = $cb(); $pdo->exec('COMMIT'); return $r; }
  catch (Throwable $e) { $pdo->exec('ROLLBACK'); throw $e; }
}

function averageScore($e) { return (int) $e['total_score']; }
// Best ratio first; equal: higher total score, then who finished first, then join order.
function dRanked($players) {
  usort($players, function ($a, $b) {
    if ($a['completed'] != $b['completed']) return $b['completed'] <=> $a['completed'];
    if ($a['total_score'] != $b['total_score']) return $b['total_score'] <=> $a['total_score'];
    $fa = $a['finished_at'] ?? PHP_INT_MAX; $fb = $b['finished_at'] ?? PHP_INT_MAX;
    if ($fa != $fb) return $fa <=> $fb;
    return $a['id'] <=> $b['id'];
  });
  return $players;
}

// Flip a lobby into the running state with a countdown (free contests go here directly).
function dBeginRunning($pdo, $cid) {
  $c = dContestId($pdo, $cid);
  $startsAt = nowMs() + COUNTDOWN_MS;
  $endsAt = $startsAt + $c['matches'] * ($c['time_limit_ms'] + PREVIEW_MS + GAP_MS);
  $pdo->prepare('UPDATE dash_contests SET status = "running", starts_at = ?, ends_at = ?, updated_at = ? WHERE id = ?')
      ->execute([$startsAt, $endsAt, nowMs(), $cid]);
}

function dSettle($pdo, $entry, $play, $result, $durationMs, $score) {
  $pdo->prepare('UPDATE dash_plays SET result = ?, duration_ms = ?, score = ? WHERE id = ?')
      ->execute([$result, $durationMs, $score, $play['id']]);
  $won = $result === 'won';
  $played = $entry['played'] + 1;
  $c = dContestId($pdo, $entry['dash_contest_id']);
  $finishedAt = $played >= $c['matches'] ? ($entry['finished_at'] ?? nowMs()) : $entry['finished_at'];
  $pdo->prepare('UPDATE dash_entries SET played = ?, completed = ?, total_score = ?, finished_at = ?, updated_at = ? WHERE id = ?')
      ->execute([$played, $entry['completed'] + ($won ? 1 : 0), $entry['total_score'] + max(0, $score), $finishedAt, nowMs(), $entry['id']]);
}

// Ends the contest once everyone has played every flight, or time is up. Runs inside the lock.
function dResolve($pdo, $contest) {
  $c = dContestId($pdo, $contest['id']);
  if ($c['status'] !== 'running' || nowMs() < $c['starts_at']) return;
  $players = dPlayers($pdo, $c['id']);
  $timeUp = nowMs() >= $c['ends_at'];
  if (!$timeUp) {
    foreach ($players as $p) if ($p['played'] < $c['matches']) return;   // still playing
  }
  // any open flights become timeouts
  foreach ($players as $p) {
    $op = $pdo->prepare('SELECT * FROM dash_plays WHERE dash_entry_id = ? AND result IS NULL'); $op->execute([$p['id']]);
    foreach ($op->fetchAll(PDO::FETCH_ASSOC) as $play) {
      $e = dEntry($pdo, $c['id'], $p['user_id']);
      dSettle($pdo, $e, $play, 'timeout', $c['time_limit_ms'], 0);
    }
  }
  $prizes = json_decode($c['prizes_cents'] ?: '[]', true) ?: [];
  foreach (dRanked(dPlayers($pdo, $c['id'])) as $i => $e) {
    $prize = ($e['completed'] > 0 && isset($prizes[$i])) ? (int) $prizes[$i] : 0;
    // Phase 2: credit $prize into the winner's wallet here.
    $pdo->prepare('UPDATE dash_entries SET place = ?, prize_cents = ?, updated_at = ? WHERE id = ?')
        ->execute([$i + 1, $prize, nowMs(), $e['id']]);
  }
  $pdo->prepare('UPDATE dash_contests SET status = "finished", finished_at = ?, updated_at = ? WHERE id = ?')
      ->execute([nowMs(), nowMs(), $c['id']]);
}

// Housekeeping: close expired lobbies, end overdue contests (Phase 2 also refunds here).
function dTick($pdo, $contest) {
  $c = dContestId($pdo, $contest['id']); if (!$c) return;
  if ($c['status'] === 'lobby' && nowMs() >= $c['expires_at']) {
    dLocked($pdo, function () use ($pdo, $c) {
      $cur = dContestId($pdo, $c['id']);
      if ($cur['status'] === 'lobby' && nowMs() >= $cur['expires_at'])
        $pdo->prepare('UPDATE dash_contests SET status = "cancelled", updated_at = ? WHERE id = ?')->execute([nowMs(), $c['id']]);
    });
  } elseif ($c['status'] === 'running' && nowMs() >= $c['ends_at']) {
    dLocked($pdo, fn() => dResolve($pdo, $c));
  }
}
function dTickDue($pdo, $limit = 50) {
  $t = nowMs();
  $q = $pdo->prepare('SELECT * FROM dash_contests WHERE (status = "lobby" AND expires_at < ?) OR (status = "running" AND ends_at < ?) LIMIT ?');
  $q->execute([$t, $t, $limit]);
  foreach ($q->fetchAll(PDO::FETCH_ASSOC) as $c) dTick($pdo, $c);
}

// Everything one player's page needs to draw the contest.
function dState($pdo, $contest, $viewerId) {
  $c = dContestId($pdo, $contest['id']);
  $players = dRanked(dPlayers($pdo, $c['id']));
  $me = dEntry($pdo, $c['id'], $viewerId);
  $prizes = json_decode($c['prizes_cents'] ?: '[]', true) ?: [];
  $pq = $pdo->prepare('SELECT COUNT(*) FROM dash_entries WHERE dash_contest_id = ? AND status = "invited" AND user_id = ?'); // unused
  $invited = [];
  if ($c['host_id'] == $viewerId) {
    $iq = $pdo->prepare('SELECT user_id FROM dash_entries WHERE dash_contest_id = ? AND status = "invited" AND user_id != ?');
    $iq->execute([$c['id'], $viewerId]);
    foreach ($iq->fetchAll(PDO::FETCH_ASSOC) as $r) $invited[] = uname($pdo, $r['user_id']);
  }
  return [
    'code' => $c['code'],
    'status' => $c['status'],
    'server_now' => nowMs(),
    'free' => (int) $c['entry_fee_cents'] === 0,
    'entry_fee_cents' => (int) $c['entry_fee_cents'],
    'prizes_cents' => $prizes,
    'matches' => (int) $c['matches'],
    'min_players' => (int) $c['min_players'],
    'max_players' => (int) $c['max_players'],
    'time_limit_ms' => (int) $c['time_limit_ms'],
    'preview_ms' => PREVIEW_MS,
    'expires_at' => (int) $c['expires_at'],
    'starts_at' => $c['starts_at'] !== null ? (int) $c['starts_at'] : null,
    'ends_at' => $c['ends_at'] !== null ? (int) $c['ends_at'] : null,
    'is_host' => $c['host_id'] == $viewerId,
    'host' => uname($pdo, $c['host_id']),
    'count' => count($players),
    'me' => $me ? [
      'status' => $me['status'],
      'played' => (int) $me['played'],
      'completed' => (int) $me['completed'],
      'total_score' => (int) $me['total_score'],
      'place' => $me['place'] !== null ? (int) $me['place'] : null,
      'prize_cents' => (int) $me['prize_cents'],
    ] : null,
    'players' => array_map(function ($e, $i) use ($pdo, $viewerId, $c) {
      return [
        'rank' => $e['place'] !== null ? (int) $e['place'] : $i + 1,
        'name' => uname($pdo, $e['user_id']),
        'me' => $e['user_id'] == $viewerId,
        'host' => $e['user_id'] == $c['host_id'],
        'played' => (int) $e['played'],
        'completed' => (int) $e['completed'],
        'total_score' => (int) $e['total_score'],
        'prize_cents' => (int) $e['prize_cents'],
      ];
    }, $players, array_keys($players)),
    'invited' => $invited,
  ];
}

$pdo = db();
$action = $_GET['action'] ?? (body()['action'] ?? '');

// ---------- TICK (public housekeeping — cron + on-visit fallback) ----------
if ($action === 'tick') { dTickDue($pdo, 200); out(['ok' => true]); }

if (!uid()) out(['error' => 'Please log in to play Dash Contests.'], 401);
$me = uid();

// ---------- OPEN (create a contest; host joins) ----------
if ($action === 'open') {
  $free = dashFree();
  $seed = random_int(1, 2000000000);
  $code = dcode($pdo);
  $pdo->prepare('INSERT INTO dash_contests (code, host_id, status, entry_fee_cents, prizes_cents, matches, min_players, max_players, time_limit_ms, seed, expires_at, updated_at)
                 VALUES (?,?,"lobby",?,?,?,?,?,?,?,?,?)')
      ->execute([$code, $me, $free ? 0 : DASH_ENTRY_CENTS, json_encode($free ? [] : DASH_PRIZES_CENTS),
                 DASH_MATCHES, max(2, DASH_MIN), max(2, DASH_MAX), DASH_FLIGHT_MS, $seed,
                 nowMs() + DASH_LOBBY_MIN * 60000, nowMs()]);
  $cid = (int) $pdo->lastInsertId();
  $pdo->prepare('INSERT INTO dash_entries (dash_contest_id, user_id, status) VALUES (?,?,"invited")')->execute([$cid, $me]);
  // Free: the host is in from the start. (Paid Phase 2: host pays first.)
  if ($free) $pdo->prepare('UPDATE dash_entries SET status = "joined", joined_at = ? WHERE dash_contest_id = ? AND user_id = ?')->execute([nowMs(), $cid, $me]);
  out(['ok' => true, 'code' => $code]);
}

// ---------- INDEX (my requests / active / open list / recent) ----------
if ($action === 'index') {
  dTickDue($pdo, 20);
  $req = $pdo->prepare('SELECT c.code, c.host_id FROM dash_entries e JOIN dash_contests c ON c.id = e.dash_contest_id
                        WHERE e.user_id = ? AND e.status = "invited" AND c.status = "lobby" AND c.expires_at > ? ORDER BY e.id DESC');
  $req->execute([$me, nowMs()]);
  $requests = array_map(fn($r) => ['code' => $r['code'], 'host' => uname($pdo, $r['host_id'])], $req->fetchAll(PDO::FETCH_ASSOC));

  $act = $pdo->prepare('SELECT c.code, c.status FROM dash_entries e JOIN dash_contests c ON c.id = e.dash_contest_id
                        WHERE e.user_id = ? AND e.status = "joined" AND c.status IN ("lobby","starting","running") ORDER BY e.id DESC');
  $act->execute([$me]);
  $active = $act->fetchAll(PDO::FETCH_ASSOC);

  $op = $pdo->prepare('SELECT c.id, c.code, c.host_id FROM dash_contests c
                       WHERE c.status = "lobby" AND c.expires_at > ?
                       AND NOT EXISTS (SELECT 1 FROM dash_entries e WHERE e.dash_contest_id = c.id AND e.user_id = ? AND e.status = "joined")
                       ORDER BY c.id DESC LIMIT 20');
  $op->execute([nowMs(), $me]);
  $open = array_map(fn($r) => ['code' => $r['code'], 'host' => uname($pdo, $r['host_id']), 'count' => dPlayerCount($pdo, $r['id'])], $op->fetchAll(PDO::FETCH_ASSOC));

  $rec = $pdo->prepare('SELECT c.code, e.place, e.completed FROM dash_entries e JOIN dash_contests c ON c.id = e.dash_contest_id
                        WHERE e.user_id = ? AND e.status = "joined" AND c.status = "finished" ORDER BY c.finished_at DESC LIMIT 8');
  $rec->execute([$me]);
  out(['free' => dashFree(), 'min' => DASH_MIN, 'max' => DASH_MAX, 'matches' => DASH_MATCHES,
       'requests' => $requests, 'active' => $active, 'open' => $open, 'recent' => $rec->fetchAll(PDO::FETCH_ASSOC)]);
}

// ---------- STATE (poll target) ----------
if ($action === 'state') {
  $code = strtoupper(trim($_GET['code'] ?? (body()['code'] ?? '')));
  $c = dContest($pdo, $code); if (!$c) out(['error' => 'Contest not found.'], 404);
  dTick($pdo, $c);
  out(dState($pdo, $c, $me));
}

// ---------- SEARCH (host finds players by name) ----------
if ($action === 'search') {
  $b = body();
  $code = strtoupper(trim($b['code'] ?? $_GET['code'] ?? '')); $c = dContest($pdo, $code);
  if (!$c) out(['error' => 'Contest not found.'], 404);
  if ($c['host_id'] != $me) out(['error' => 'Only the host can invite.'], 403);
  $term = trim($b['q'] ?? $_GET['q'] ?? '');
  if (mb_strlen($term) < 2) out([]);
  $like = '%' . str_replace(['%', '_'], ['\%', '\_'], $term) . '%';
  $taken = $pdo->prepare('SELECT user_id FROM dash_entries WHERE dash_contest_id = ? AND status IN ("joined","invited")');
  $taken->execute([$c['id']]);
  $takenIds = array_column($taken->fetchAll(PDO::FETCH_ASSOC), 'user_id');
  $ph = $takenIds ? implode(',', array_fill(0, count($takenIds), '?')) : '0';
  $q = $pdo->prepare("SELECT id, email, callsign FROM users
                      WHERE (callsign LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\') AND id NOT IN ($ph)
                      ORDER BY callsign, email LIMIT 8");
  $q->execute(array_merge([$like, $like], $takenIds));
  out(array_map(fn($u) => ['id' => (int) $u['id'], 'name' => $u['callsign'] ?: explode('@', $u['email'])[0]], $q->fetchAll(PDO::FETCH_ASSOC)));
}

// ---------- INVITE ----------
if ($action === 'invite') {
  $b = body(); $code = strtoupper(trim($b['code'] ?? '')); $pid = (int) ($b['user_id'] ?? 0);
  $c = dContest($pdo, $code); if (!$c) out(['error' => 'Contest not found.'], 404);
  $u = $pdo->prepare('SELECT id FROM users WHERE id = ?'); $u->execute([$pid]);
  if (!$u->fetch()) out(['error' => 'Player not found.'], 404);
  dLocked($pdo, function () use ($pdo, $c, $me, $pid) {
    $cur = dContestId($pdo, $c['id']);
    if ($cur['host_id'] != $me) out(['error' => 'Only the host can send requests.'], 403);
    if ($cur['status'] !== 'lobby') out(['error' => 'The contest has already started.'], 409);
    $host = dEntry($pdo, $cur['id'], $me);
    if (!$host || $host['status'] !== 'joined') out(['error' => 'Pay your entry fee first, then send requests.'], 409);
    $e = dEntry($pdo, $cur['id'], $pid);
    if ($e && in_array($e['status'], ['joined', 'invited'], true)) return;
    $e ? $pdo->prepare('UPDATE dash_entries SET status = "invited", updated_at = ? WHERE id = ?')->execute([nowMs(), $e['id']])
       : $pdo->prepare('INSERT INTO dash_entries (dash_contest_id, user_id, status) VALUES (?,?,"invited")')->execute([$cur['id'], $pid]);
  });
  out(dState($pdo, dContest($pdo, $code), $me));
}

// ---------- DECLINE ----------
if ($action === 'decline') {
  $code = strtoupper(trim(body()['code'] ?? '')); $c = dContest($pdo, $code);
  if (!$c) out(['error' => 'Contest not found.'], 404);
  $pdo->prepare('UPDATE dash_entries SET status = "declined", updated_at = ? WHERE dash_contest_id = ? AND user_id = ? AND status = "invited"')
      ->execute([nowMs(), $c['id'], $me]);
  out(['ok' => true]);
}

// ---------- JOIN (free contests) ----------
if ($action === 'join') {
  $code = strtoupper(trim(body()['code'] ?? '')); $c = dContest($pdo, $code);
  if (!$c) out(['error' => 'Contest not found.'], 404);
  if ((int) $c['entry_fee_cents'] !== 0) out(['error' => 'This is a paid contest.'], 402);
  $started = dLocked($pdo, function () use ($pdo, $c, $me) {
    $cur = dContestId($pdo, $c['id']);
    $e = dEntry($pdo, $cur['id'], $me);
    if ($e && $e['status'] === 'joined') return false;
    if ($cur['status'] !== 'lobby') out(['error' => 'This contest has already started.'], 409);
    if (nowMs() >= $cur['expires_at']) out(['error' => 'This contest has closed.'], 409);
    if (dPlayerCount($pdo, $cur['id']) >= $cur['max_players']) out(['error' => 'This contest is full.'], 409);
    $e ? $pdo->prepare('UPDATE dash_entries SET status = "joined", joined_at = ?, updated_at = ? WHERE id = ?')->execute([nowMs(), nowMs(), $e['id']])
       : $pdo->prepare('INSERT INTO dash_entries (dash_contest_id, user_id, status, joined_at) VALUES (?,?,"joined",?)')->execute([$cur['id'], $me, nowMs()]);
    if (dPlayerCount($pdo, $cur['id']) >= $cur['max_players']) { dBeginRunning($pdo, $cur['id']); return true; }  // auto-start when full
    return false;
  });
  out(dState($pdo, dContest($pdo, $code), $me));
}

// ---------- LEAVE (lobby only) ----------
if ($action === 'leave') {
  $code = strtoupper(trim(body()['code'] ?? '')); $c = dContest($pdo, $code);
  if (!$c) out(['error' => 'Contest not found.'], 404);
  dLocked($pdo, function () use ($pdo, $c, $me) {
    $cur = dContestId($pdo, $c['id']);
    $e = dEntry($pdo, $cur['id'], $me);
    if ($cur['status'] !== 'lobby' || !$e || !in_array($e['status'], ['joined', 'invited'], true)) return;
    $pdo->prepare('UPDATE dash_entries SET status = "left", updated_at = ? WHERE id = ?')->execute([nowMs(), $e['id']]);
    if ($cur['host_id'] == $me) {
      $next = $pdo->prepare('SELECT user_id FROM dash_entries WHERE dash_contest_id = ? AND status = "joined" ORDER BY joined_at ASC, id ASC LIMIT 1');
      $next->execute([$cur['id']]); $nid = $next->fetchColumn();
      if (!$nid) {
        $inv = $pdo->prepare('SELECT user_id FROM dash_entries WHERE dash_contest_id = ? AND status = "invited" ORDER BY id ASC LIMIT 1');
        $inv->execute([$cur['id']]); $nid = $inv->fetchColumn();
      }
      $nid ? $pdo->prepare('UPDATE dash_contests SET host_id = ?, updated_at = ? WHERE id = ?')->execute([$nid, nowMs(), $cur['id']])
           : $pdo->prepare('UPDATE dash_contests SET status = "cancelled", updated_at = ? WHERE id = ?')->execute([nowMs(), $cur['id']]);
    }
  });
  out(['ok' => true]);
}

// ---------- START (host, once ≥ min players) ----------
if ($action === 'start') {
  $code = strtoupper(trim(body()['code'] ?? '')); $c = dContest($pdo, $code);
  if (!$c) out(['error' => 'Contest not found.'], 404);
  dLocked($pdo, function () use ($pdo, $c, $me) {
    $cur = dContestId($pdo, $c['id']);
    if ($cur['host_id'] != $me) out(['error' => 'Only the host can start the contest.'], 403);
    if ($cur['status'] !== 'lobby') return;
    if (dPlayerCount($pdo, $cur['id']) < $cur['min_players']) out(['error' => "At least {$cur['min_players']} players are needed."], 400);
    dBeginRunning($pdo, $cur['id']);   // free: straight to running. Phase 2 paid: charge entry fees first.
  });
  out(dState($pdo, dContest($pdo, $code), $me));
}

// ---------- NEXT (hand out the player's next flight) ----------
if ($action === 'next') {
  $code = strtoupper(trim(body()['code'] ?? '')); $c = dContest($pdo, $code);
  if (!$c) out(['error' => 'Contest not found.'], 404);
  $flight = dLocked($pdo, function () use ($pdo, $c, $me) {
    dResolve($pdo, $c);
    $cur = dContestId($pdo, $c['id']);
    if ($cur['status'] !== 'running' || nowMs() < $cur['starts_at']) return null;
    $entry = dEntry($pdo, $cur['id'], $me);
    if (!$entry || $entry['status'] !== 'joined') out(['error' => 'You are not in this contest.'], 403);
    $op = $pdo->prepare('SELECT * FROM dash_plays WHERE dash_entry_id = ? AND result IS NULL ORDER BY match_no ASC LIMIT 1');
    $op->execute([$entry['id']]); $play = $op->fetch(PDO::FETCH_ASSOC) ?: null;
    if ($play) {
      $deadline = $play['issued_at'] + PREVIEW_MS + $cur['time_limit_ms'] + REPORT_GRACE_MS;
      if (nowMs() > $deadline) { dSettle($pdo, $entry, $play, 'timeout', $cur['time_limit_ms'], 0); $play = null; $entry = dEntry($pdo, $cur['id'], $me); }
    }
    if (!$play) {
      if ($entry['played'] >= $cur['matches'] || nowMs() >= $cur['ends_at']) return null;
      $mn = $entry['played'] + 1;
      $pdo->prepare('INSERT INTO dash_plays (dash_entry_id, match_no, issued_at) VALUES (?,?,?)')->execute([$entry['id'], $mn, nowMs()]);
      $play = ['match_no' => $mn, 'issued_at' => nowMs()];
    }
    return ['match_no' => (int) $play['match_no'], 'seed' => seedFor($cur['seed'], $play['match_no']),
            'race_start' => (int) $play['issued_at'] + PREVIEW_MS, 'time_limit_ms' => (int) $cur['time_limit_ms']];
  });
  out(['flight' => $flight, 'state' => dState($pdo, dContest($pdo, $code), $me)]);
}

// ---------- FINISH (report a flight result) ----------
if ($action === 'finish') {
  $b = body(); $code = strtoupper(trim($b['code'] ?? ''));
  $matchNo = (int) ($b['match_no'] ?? 0);
  $result = in_array($b['result'] ?? '', ['won', 'crashed', 'timeout'], true) ? $b['result'] : 'crashed';
  $durationMs = max(0, min((int) ($b['duration_ms'] ?? 0), 600000));
  $score = max(0, min((int) ($b['score'] ?? 0), SCORE_CAP));
  $c = dContest($pdo, $code); if (!$c) out(['error' => 'Contest not found.'], 404);
  dLocked($pdo, function () use ($pdo, $c, $me, $matchNo, $result, $durationMs, $score) {
    $cur = dContestId($pdo, $c['id']);
    if ($cur['status'] !== 'running') return;
    $entry = dEntry($pdo, $cur['id'], $me);
    if (!$entry || $entry['status'] !== 'joined') return;
    $pq = $pdo->prepare('SELECT * FROM dash_plays WHERE dash_entry_id = ? AND match_no = ? AND result IS NULL');
    $pq->execute([$entry['id'], $matchNo]); $play = $pq->fetch(PDO::FETCH_ASSOC);
    if (!$play) return;
    // anti-cheat on a survive: the clock started PREVIEW_MS after the flight was handed out.
    $elapsed = nowMs() - ($play['issued_at'] + PREVIEW_MS);
    if ($result === 'won') {
      $possible = $durationMs >= 1000 && $durationMs <= $cur['time_limit_ms'] + 250 && $durationMs <= $elapsed + 1500;
      if (!$possible) out(['error' => 'That result is not possible.'], 422);
    }
    dSettle($pdo, $entry, $play, $result, min($durationMs, $cur['time_limit_ms']), $score);
    dResolve($pdo, $c);
  });
  // hand out the next flight immediately
  $flight = null; $c = dContest($pdo, $code);
  if ($c['status'] === 'running') {
    $flight = dLocked($pdo, function () use ($pdo, $c, $me) {
      $cur = dContestId($pdo, $c['id']);
      if ($cur['status'] !== 'running' || nowMs() < $cur['starts_at']) return null;
      $entry = dEntry($pdo, $cur['id'], $me);
      if (!$entry || $entry['played'] >= $cur['matches'] || nowMs() >= $cur['ends_at']) return null;
      $mn = $entry['played'] + 1;
      $pdo->prepare('INSERT OR IGNORE INTO dash_plays (dash_entry_id, match_no, issued_at) VALUES (?,?,?)')->execute([$entry['id'], $mn, nowMs()]);
      $iq = $pdo->prepare('SELECT issued_at FROM dash_plays WHERE dash_entry_id = ? AND match_no = ?'); $iq->execute([$entry['id'], $mn]);
      $issued = (int) $iq->fetchColumn();
      return ['match_no' => $mn, 'seed' => seedFor($cur['seed'], $mn), 'race_start' => $issued + PREVIEW_MS, 'time_limit_ms' => (int) $cur['time_limit_ms']];
    });
  }
  out(['flight' => $flight, 'state' => dState($pdo, dContest($pdo, $code), $me)]);
}

out(['error' => 'Unknown action'], 400);
