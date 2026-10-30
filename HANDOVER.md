# RogerATC — Source Handover

Everything needed to run, deploy, and maintain **RogerATC.com** and its free
variant **BreezeRogerATC.com**.

> ⚠️ **No API keys are included in this package** (by design). Real Stripe /
> Google / Square keys live only on the server, outside the web root, and are
> never committed to source control. See **Secrets setup** below.

---

## Tech stack
- **Frontend:** vanilla HTML5 Canvas game + UI — no build step. `index.html`
  (RogerATC) and `breeze.html` (Breeze). Shared engine in `js/`, styles in `css/`,
  art in `assets/`.
- **Backend:** PHP 8.3 + SQLite (PDO). All endpoints in `api/`.
- **Auth:** email/password + Google Sign-In, PHP sessions.
- **Payments:** Stripe Checkout (subscriptions) and optional Square Web Payments.

## Run locally
Open `index.html` in any modern browser — the **game** needs no server.
To exercise accounts/payments, run PHP from the project root:
```
php -S 127.0.0.1:8000
```
then visit http://127.0.0.1:8000/index.html

## Project layout
```
index.html / breeze.html   the two sites (Breeze = free, no payments, no ads)
css/  js/  assets/          frontend (ui.js, game.js, data.js, audio.js)
assets/backgrounds/         the 16 unlockable "survive" backgrounds
api/                        PHP backend (auth, pay, webhook, match, ad, msg, …)
deploy-hostinger.sh         one-command deploy to Hostinger (git + ssh)
secrets.example.php         TEMPLATE → becomes ~/.rogeratc-data/secrets.php
square.example.php          TEMPLATE → becomes ~/.rogeratc-data/square.php
```

## Secrets setup (required for login & payments)
Secrets are read from **outside** the web root so they can never be downloaded
or leaked through git:
```
~/domains/.rogeratc-data/secrets.php     (Stripe + Google)   chmod 600
~/domains/.rogeratc-data/square.php      (Square, optional)  chmod 600
```
1. Copy `secrets.example.php` → `secrets.php`, fill in real values.
2. Copy `square.example.php` → `square.php` (or leave `square_enabled => false`).

Keys to obtain:
| Key | Where from |
|-----|-----------|
| `stripe_secret`, `stripe_pub` | Stripe Dashboard → Developers → API keys |
| `stripe_webhook` | Stripe → Webhooks → endpoint `/api/webhook.php` → signing secret |
| `google_client_id` | Google Cloud → Credentials → OAuth Client ID (add site origins) |
| `square_*` | Square Developer Dashboard (only if enabling Square) |

## Database
SQLite, auto-created on first request at
`~/domains/.rogeratc-data/auth.sqlite` (outside the web root). Tables and
column migrations are created automatically — nothing to import. No database
file is shipped (it would contain real user data).

## Deploy (Hostinger)
`deploy-hostinger.sh` pushes to git, `git reset --hard` on the server, busts the
asset cache, and mirrors Breeze. Set your own `SSH_USER/HOST/PORT/PATH` at the
top of the script (from hPanel → Advanced → SSH Access), then:
```
bash deploy-hostinger.sh
```
Requirements on the host: PHP 8.3, SQLite3 + PDO_SQLite, git.

## Notes
- **Breeze** is the free build: no payments, no ads, no unlockable backgrounds
  (it serves its own fixed background). Same engine, gated by a `body.breeze` flag.
- Unlockable backgrounds appear on RogerATC as the player survives flights.
- `.htaccess` blocks web access to `.git`, credential files, and shell scripts.
