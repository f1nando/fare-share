# City demo

`npm run build:city` builds the standalone city and FPS tool into `dist-city/`.
It does not include the TaxiDashboard entry or require a backend.

Host: `bkserv`, URL: https://city.monosoftware.dev/.
Nginx configuration: `deploy/city.nginx.conf`, installed as
`/etc/nginx/sites-available/city.monosoftware.dev` and enabled by symlink.
Uses the existing `monosoftware-wildcard` certificate.

The same standalone city release is also available at
https://taxicity.demotest.live/. Its Nginx configuration is
`deploy/taxicity.demotest.live.nginx.conf`, installed as
`/etc/nginx/sites-available/taxicity.demotest.live` and enabled by symlink.
It uses a dedicated Let's Encrypt certificate managed by Certbot.

Upload each build to a new `/var/www/taxi-city/releases/<release>/` directory,
then atomically replace `/var/www/taxi-city/current` with a symlink to it.
Set uploaded directories to mode `755` and static files to `644` so nginx can read them
(Windows SCP may copy restrictive directory permissions).
Run `nginx -t` before reloading nginx for configuration changes.
Rollback: atomically point `current` to the previous release. Keep old releases
until they are no longer needed. Never upload source files or environment files.

Smoke: HTTPS `/` and its assets return 200; HTTP redirects to HTTPS; the city
and settings render on desktop/mobile. FPS tool: `/?benchmark=1&duration=20`.

## FARE Taxi Park

Host: `bkserv`, URL: `https://taxi.demotest.live/`.
Nginx source configuration: `deploy/taxi.demotest.live.nginx.conf`; the live copy is
`/etc/nginx/sites-available/taxi.demotest.live` and is enabled by symlink.
HTTPS uses the Let's Encrypt certificate at `/etc/letsencrypt/live/taxi.demotest.live/`;
Certbot installed automatic renewal on `bkserv`.

Upload each frontend build to a new `/var/www/taxi-park/releases/<release>/`
directory and atomically point `/var/www/taxi-park/current` to it. Do not upload
source files, `.env` files or keypairs. The public site remains a frontend demo
until the Solana program, `$FARE`, permanent metadata and backend configuration
are initialized separately.

## ownataxi.com

Host: `feeserv`. Static releases live in `/var/www/ownataxi/releases/` and the
backend source releases in `/srv/ownataxi/releases/`; both use an atomic `current`
symlink. Install `deploy/ownataxi.nginx.conf` as the enabled `ownataxi.com` site
and install both `deploy/ownataxi-backend.service` and
`deploy/ownataxi-worker.service` under `/etc/systemd/system/`.

All source delivery to `feeserv` must go through GitHub. After the approved
release commit is pushed to `origin/main`, run `git fetch` on the server and
create a new release directory by checking out that exact commit SHA in detached
mode. Do not upload full source archives with SCP/SSH and never copy
`node_modules` between the workstation and server. Keep the previous release and
its `current` symlink untouched until the new checkout has passed its checks.

Compare `package-lock.json` with the dependency set already installed on the
server. Run `npm ci` only when the lockfile changed; otherwise reuse the matching
server-side dependencies without reinstalling them. Build the frontend on the
server, or transfer only the small ready `dist` artifact when a server build is
not possible. After backend health, frontend, and `nginx -t` checks pass,
atomically switch both `current` symlinks and restart the backend. A failed
pre-switch check leaves the previous release active. Do not rerun the full
rehearsal for a small fix: use focused checks during development and one complete
rehearsal only for the frozen release candidate.

The ignored production environment is installed separately as
`/etc/ownataxi/ownataxi.env` with mode `640`, owned by `root:ownataxi`. Never put
that file, keypairs or secret values in a frontend release or Git. The frontend
uses same-origin `https://ownataxi.com/api/`; nginx proxies it to the backend on
`127.0.0.1:8787`. Validate with `nginx -t`, restart the backend, atomically switch
both symlinks, then smoke `/`, `/admin/`, `/api/token` and the Solana mint state.
The worker service may run during rehearsal preparation, but
`WORKER_INITIAL_ENABLED=false` and the MongoDB runtime setting must keep automation
OFF until the mandatory manual worker cycle passes. Start or enable automation only
through the protected admin flow; never by changing the service unit.

Cloudflare is authoritative for `ownataxi.com`; the root and `www` records are
proxied. Install `deploy/cloudflare-origin-only.conf` as
`/etc/nginx/snippets/cloudflare-origin-only.conf` before installing the site
configuration. The allowlist prevents direct HTTPS access to the known origin
IP while the ACME HTTP challenge remains reachable. UFW must allow OpenSSH,
80/tcp and 443/tcp, deny 8787/tcp, and remain enabled. When Cloudflare changes
its published IP ranges, update both the repository snippet and the installed
copy, run `nginx -t`, then reload nginx.

The Cloudflare zone uses Full (strict), Always Use HTTPS, minimum TLS 1.2,
Cloudflare Managed Ruleset, Super Bot Fight Mode with Managed Challenge, and
both available per-IP rate limits: 120 POST requests/minute for
`/api/solana-rpc`, plus 30 requests/minute across expensive trade/voucher/mint,
admin-login and trade-stream endpoints. Re-check Security Events before making
these limits stricter; wallet and trade flows must continue to work without a
challenge loop.

`VITE_MAGIC_EDEN_MARKET_URL` is a build-time public value. Leave it unset while
`/market/` is only a UI prototype. Set it only to the verified official production
collection page after Magic Eden confirmation; a generic marketplace home page or
the disposable test collection is not an acceptable production value.
