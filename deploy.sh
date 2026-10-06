#!/usr/bin/env bash
#
# deploy.sh — RogerATC one-command deploy
#
#   Run from your Mac:   ./deploy.sh  "optional commit message"
#
#   It will:
#     1. commit all local changes
#     2. push to the git remote (origin)
#     3. SSH into the server and pull the latest (via key auth)
#
#   One-time setup is documented at the bottom of this file.
#
set -euo pipefail

# ============================================================
#  CONFIG  — fill in SSH_HOST and SSH_PORT (see steps below)
# ============================================================
SSH_USER="sty2"                                   # cPanel username
SSH_HOST="REPLACE_WITH_HOST"                      # server hostname/IP or your domain
SSH_PORT="22"                                     # cPanel SSH port (often NOT 22 — check SSH Access)
SERVER_PATH="/home/sty2/public_html/rogeratc"     # repo folder on the server
BRANCH="main"
SERVER="${SSH_USER}@${SSH_HOST}"
# ============================================================

cd "$(dirname "$0")"

MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M:%S')}"

echo "➤ 1/3  Committing local changes..."
git add -A
if git diff --cached --quiet; then
  echo "   (no changes to commit — deploying current HEAD)"
else
  git commit -m "$MSG"
fi

echo "➤ 2/3  Pushing to origin/$BRANCH..."
git push origin "$BRANCH"

echo "➤ 3/3  Updating server ($SERVER:$SSH_PORT)..."
ssh -p "$SSH_PORT" "$SERVER" "cd '$SERVER_PATH' && git fetch --all --quiet && git reset --hard origin/$BRANCH && echo '   server now at:' \$(git rev-parse --short HEAD)"

echo "✅ Deployed.  Live at:  https://<your-domain>/rogeratc/"

# ============================================================
#  ONE-TIME SETUP (do this once)
# ============================================================
#  Already done:  GitHub repo + first push.
#
#  On the SERVER — clone the repo into public_html/rogeratc.
#  Easiest via cPanel ▸ Terminal (Advanced section), or over SSH:
#     cd /home/sty2/public_html
#     git clone https://github.com/stallyons-developer1/RogerATC.git rogeratc
#
#  Then from your Mac, every future update is just:
#     ./deploy.sh
# ============================================================
