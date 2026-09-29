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
and `deploy/ownataxi-backend.service` as `/etc/systemd/system/ownataxi-backend.service`.

The ignored production environment is installed separately as
`/etc/ownataxi/ownataxi.env` with mode `640`, owned by `root:ownataxi`. Never put
that file, keypairs or secret values in a frontend release or Git. The frontend
uses same-origin `https://ownataxi.com/api/`; nginx proxies it to the backend on
`127.0.0.1:8787`. Validate with `nginx -t`, restart the backend, atomically switch
both symlinks, then smoke `/`, `/admin/`, `/api/token` and the Solana mint state.
