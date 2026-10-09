# Independent Own a Taxi monitor

Runs on `bkserv`, observes `feeserv`, and performs no transactions. A separate
MongoDB database (`ownataxi_monitor`) persists the first private-chat recipient,
Telegram offset, and alert state. Only one polling instance may use this bot.

Checks: HTTPS website, health API, token API, overview API, production host,
backend service, production MongoDB, Solana RPC, explicit payer SOL balance,
disk usage, enabled-worker progress, and recent application errors. Intentionally
disabled workers are not failures. Checks every 30 seconds; three failures trigger
an alert (low SOL immediately), repeats every 30 minutes, recovery once. `/status`
returns current checks; daily summaries are automatic. These are operational
checks, not proof that minting or trading succeeds; no paid operation is tested.

Install just this directory's dependencies with `npm ci --omit=dev`. Run with
`node --env-file=/etc/ownataxi-monitor/monitor.env monitor.mjs`. Environment:
`TELEGRAM_BOT_TOKEN_FILE`, `MONITOR_MONGODB_URI`, `MONITOR_SITE_URL`,
`MONITOR_SSH_KEY`, `MONITOR_SSH_TARGET`, and optionally `MONITOR_SSH_KNOWN_HOSTS`
(default `/etc/ownataxi-monitor/known_hosts`). Pin the production host key obtained
over an already trusted connection. Secrets stay outside Git.

On feeserv, `snapshot.mjs` runs with the existing production environment and an
explicit `MONITOR_PAYER_ADDRESS`. The observer SSH key must have a forced command
running only this probe and `restrict`; never grant it an unrestricted shell.
Use a dedicated unprivileged account with read access to the production env file.
Deploy the observer into its own exact-SHA checkout, without switching application
symlinks or restarting the backend/worker. Both checkouts are delivered via Git.

Install `deploy/ownataxi-monitor.service` on bkserv. Auto-start and restart are
managed by systemd. Do not run the old worker bot poller with the same bot token.
Changing the recipient requires a server-side operator to clear `chatId` in the
`recipients` document `_id: admin` and restart the monitor; record the operation.
No Telegram command can transfer the administrator role.
