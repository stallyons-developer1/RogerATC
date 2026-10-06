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
#  CONFIG  — edit these three lines for your server
# ============================================================
SERVER="user@your-server.com"              # SSH  user@host  (uses your SSH key)
SERVER_PATH="/var/www/html/rogeratc"       # the repo folder ON the server
BRANCH="main"                              # git branch to deploy
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

echo "➤ 3/3  Updating server ($SERVER)..."
ssh "$SERVER" "cd '$SERVER_PATH' && git fetch --all --quiet && git reset --hard origin/$BRANCH && echo '   server now at:' \$(git rev-parse --short HEAD)"

echo "✅ Deployed successfully."

# ============================================================
#  ONE-TIME SETUP
# ============================================================
#  On your Mac (first time only):
#     git remote add origin git@github.com:devStallyons/RogerATC.git
#     git push -u origin main
#
#  On the server (first time only — clones the repo):
#     git clone git@github.com:devStallyons/RogerATC.git "/var/www/html/rogeratc"
#     # make sure the web root points at this folder
#
#  Make this script runnable (first time only):
#     chmod +x deploy.sh
#
#  After that, every update is just:
#     ./deploy.sh
# ============================================================
