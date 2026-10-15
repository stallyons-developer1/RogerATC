#!/usr/bin/env bash
#
# deploy-hostinger.sh — deploy RogerATC + Breeze to Hostinger Business hosting
#
#   Run from your Mac:   ./deploy-hostinger.sh  "optional commit message"
#
#   Roger  -> rogeratc.com        (full repo)
#   Breeze -> breezerogeratc.com  (breeze.html as index + symlinks to Roger's
#             assets/css/js/api, so BOTH share one SQLite DB = one account works on both)
#
#   DB auto-creates at ~/domains/.rogeratc-data/auth.sqlite (outside public_html, safe).
#
set -euo pipefail

# ============================================================
#  Hostinger SSH  (from hPanel > Advanced > SSH Access)
# ============================================================
SSH_USER="u145944355"
SSH_HOST="82.197.80.148"
SSH_PORT="65002"
ROGER_PATH="domains/rogeratc.com/public_html"          # relative to ~  (confirm in File Manager)
BREEZE_PATH="domains/breezerogeratc.com/public_html"
BRANCH="main"
SERVER="${SSH_USER}@${SSH_HOST}"
# ============================================================

cd "$(dirname "$0")"
MSG="${1:-deploy: $(date '+%Y-%m-%d %H:%M:%S')}"

echo "➤ 1/3  Committing local changes..."
git add -A
git diff --cached --quiet || git commit -m "$MSG"

echo "➤ 2/3  Pushing to origin/$BRANCH..."
git push origin "$BRANCH"

echo "➤ 3/3  Updating Hostinger ($SERVER:$SSH_PORT)..."
ssh -p "$SSH_PORT" "$SERVER" bash -s <<EOF
set -e
cd ~/$ROGER_PATH
git fetch --all --quiet
git reset --hard origin/$BRANCH
H=\$(git rev-parse --short HEAD)
sed -i "s/DEPLOYVER/\$H/g" index.html breeze.html
# Breeze shares Roger's code + DB via symlinks
mkdir -p ~/$BREEZE_PATH
cd ~/$BREEZE_PATH
ln -sfn ~/$ROGER_PATH/assets   assets
ln -sfn ~/$ROGER_PATH/css      css
ln -sfn ~/$ROGER_PATH/js       js
ln -sfn ~/$ROGER_PATH/api      api
ln -sfn ~/$ROGER_PATH/.htaccess .htaccess
cp -f  ~/$ROGER_PATH/breeze.html index.html
echo "   deployed: \$H (cache-busted, breeze mirrored)"
EOF

echo "✅ Done."
echo "   Roger:  https://rogeratc.com"
echo "   Breeze: https://breezerogeratc.com"

# ============================================================
#  ONE-TIME SETUP (run once, over SSH)
# ============================================================
#  1) In hPanel add BOTH domains as websites (creates the public_html folders)
#     and set PHP 8.x for each.
#
#  2) SSH in and clone the repo into Roger's web root:
#       ssh -p 65002 u145944355@82.197.80.148
#       cd ~/domains/rogeratc.com/public_html
#       rm -rf ..?* .[!.]* *                       # clear Hostinger's default files
#       git clone https://stallyons-developer1:YOUR_TOKEN@github.com/stallyons-developer1/RogerATC.git .
#
#  3) Back on your Mac, deploy anytime with:
#       ./deploy-hostinger.sh
#
#  (Optional) passwordless deploy — add your Mac's key once:
#       ssh-copy-id -p 65002 u145944355@82.197.80.148
# ============================================================
