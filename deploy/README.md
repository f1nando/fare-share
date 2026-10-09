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

The public testing entry point is `https://ownataxi.com/rehearsal/`. All normal
product routes also work below this prefix, for example
`/rehearsal/mint/`, `/rehearsal/garage/`, and `/rehearsal/trade/`. Use this
prefixed route for owner testing of current rehearsal work. Publishing a web
release there does not authorize worker activation or any Mainnet transaction.

Production and rehearsal are separate frontend channels:

- `/var/www/ownataxi/production-current` serves the normal domain;
- `/var/www/ownataxi/rehearsal-current` serves `/rehearsal/`;
- `npm run build:holding` creates the landing-only production build with the CA
  displayed as `COMING SOON`;
- `npm run build:rehearsal` creates the full prefixed testing build;
- the normal `npm run build` output is the full root-path promotion candidate.

Ordinary work updates only `rehearsal-current`. Never switch
`production-current` unless the owner explicitly asks to update or promote the
normal domain. Use `deploy/switch-ownataxi-frontend.sh` for either atomic switch.
To promote a tested release, point `production-current` to that release's full
root-path build; rollback uses the previous symlink target. The holding build
contains only `index.html`, and nginx returns `404` for product pages outside
`/rehearsal/` while it is active.

All source delivery to `feeserv` must go through GitHub. After the approved
release commit is pushed to `origin/main`, run `git fetch` on the server and
create a new release directory by checking out that exact commit SHA in detached
mode. Do not upload full source archives with SCP/SSH and never copy
`node_modules` between the workstation and server. Keep the previous release and
its `current` symlink untouched until the new checkout has passed its checks.

Compare `package-lock.json` with the dependency set already installed on the
server. Run `npm ci` only when the lockfile changed; otherwise reuse the matching
server-side dependencies without reinstalling them. The first Git-based release
may create one validated dependency cache with `npm ci` when no valid cache
exists. Later releases with the same normalized lockfile must use a server-local
hardlink clone of that cache. Do not symlink the complete `node_modules`
directory: TypeScript `NodeNext` may resolve package exports incorrectly through
the external real path. Build the frontend on the
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

The independent Telegram monitor runs on `bkserv` (`ownataxi-monitor.service`).
Cloudflare custom rule `Own a Taxi bkserv read-only health monitor` skips only
Super Bot Fight Mode for source IPs `89.127.213.129` and `2a02:6b40:2000:293a::1`,
host `ownataxi.com`, method `GET`, empty query string, and paths `/`, `/api/health`,
`/api/token`, `/api/public/overview`. WAF managed rules and rate limits remain
enabled; all other traffic is unaffected. Rule ID:
`baf4eb65ea81434fb188185739d5831a`. If observer IPs change, update this narrow rule
and verify both IPv4/IPv6 monitoring and challenge protection outside its scope.

The `MARKET` navigation item and direct `/market/` route currently open the Magic
Eden home page. Replace that URL with the verified official production collection
page after Magic Eden confirms it; never link the disposable rehearsal collection
from production.
