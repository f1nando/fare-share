# City demo

`npm run build:city` builds the standalone city and FPS tool into `dist-city/`.
It does not include the TaxiDashboard entry or require a backend.

Host: `bkserv`, URL: https://city.monosoftware.dev/.
Nginx configuration: `deploy/city.nginx.conf`, installed as
`/etc/nginx/sites-available/city.monosoftware.dev` and enabled by symlink.
Uses the existing `monosoftware-wildcard` certificate.

Upload each build to a new `/var/www/taxi-city/releases/<release>/` directory,
then atomically replace `/var/www/taxi-city/current` with a symlink to it.
Run `nginx -t` before reloading nginx for configuration changes.
Rollback: atomically point `current` to the previous release. Keep old releases
until they are no longer needed. Never upload source files or environment files.

Smoke: HTTPS `/` and its assets return 200; HTTP redirects to HTTPS; the city
and settings render on desktop/mobile. FPS tool: `/?benchmark=1&duration=20`.
