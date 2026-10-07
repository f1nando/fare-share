# PDA paid mint validation

## Devnet recovery — 2026-10-07

The owner explicitly authorized retiring the old devnet deployment to reclaim
test SOL. Mainnet was not changed.

- Network genesis: `EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG`.
- Retired Program: `FJgPHdMEFi8JQSeW7h9ogLCDvm2gixWkXG8g7tqn7aJr`.
- ProgramData: `JCqoDDvdLRS6nMDNuwVTaP3ANRERwMkaZLdTcGNsYBzm`.
- Explicit authority, fee payer and recipient:
  `2NUNSxorimMYT4pBqasMcN2rgPqA8cMPqXZkEs2EGVnF` (devnet only).
- Checked supply `[0,0,0,0]`, paused before closing, all token vault amounts zero,
  and SOL fee vault exactly at its rent floor.
- Pause: `3BhkR73LTNVvJjPW1EZoDhzWjKp9U9EfZqDU7pGobk2f3FxgMzecrBU8hmdDEqWhcpwzXYqh7ZeK5iqYh1ESMzYu`.
- Close: `2iJ2dZcFpdwDTGhbB9d9N7YD4VrrBQHMrAXpJvfANJiQHhJJSAyyqE5ekQ8T82sFPQ7BvYNKiJMFo2ERc6ZAeox7`.
- Reclaimed ProgramData rent: `3.829004280 SOL`.
- Wallet balance: `4.684981558 → 8.513975838 SOL`, including two transaction fees.
- ProgramData absence verified at finalized commitment. The Program ID is
  permanently retired on devnet; its small loader-v3 tombstone remains.

The existing `.env.devnet` still names this retired deployment. Do not use it for
further devnet writes; a future devnet deployment needs a fresh Program keypair
and a matching non-mainnet `declare_id!`. Mainnet identity must remain unchanged.

## Local Core CPI smoke

`scripts/pda-mint-local-smoke.mjs` prepares read-only devnet fixtures outside Git
and runs transactions only at `http://127.0.0.1:8898`. Both devnet and mainnet
genesis hashes are rejected for writes. Local keys are generated independently;
the script never loads the user's authority keypair.

Run from the repository with a **fresh external directory**:

```text
node --import tsx scripts/pda-mint-local-smoke.mjs prepare <external-directory>
node --import tsx scripts/pda-mint-local-smoke.mjs run <external-directory>
```

Between these commands, start `solana-test-validator` in WSL with a fresh ledger,
`--rpc-port 8898 --faucet-port 9908 --ticks-per-slot 8`, explicit `--mint` using
the generated local owner public key, `--url https://api.devnet.solana.com`,
`--clone-upgradeable-program CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d`,
`--bpf-program <program-from-fixtures.json> <new-taxi_park.so>`, and one
`--account <address> <external-directory>/<address>.json` for each fixture account.
Build SBF without the `mainnet` feature. Stop only this validator after the run.

The local validator loads the newly built Taxi SBF under the old devnet identity
(only in localhost) and clones the real devnet Metaplex Core executable.
Fixture overrides enable sale, clear pause, bind an ephemeral test quote signer,
and use WSOL for a small test payment. These overrides are never sent to devnet.
This tests CPI and lifecycle compatibility, not production price discovery.

Result on 2026-10-07: **PASS** for one-signature mint, exact token payment,
duplicate rejection, listing, listing cancellation, atomic purchase and direct
Core transfer. Generated PDA asset: `8F2bN8TtPgnV2ULpfrExDMcyH7X2PmvqzHp86wLhMgPF`.
The test transaction was 1,125 wire bytes **without ALT**; this is not a
measurement of the production ALT-compressed transaction or Lighthouse overhead.
The validator used eight ticks per slot to keep focused finalization checks fast.
Evidence and test keys remain outside Git. Phantom Lighthouse must still be
checked separately through the actual wallet; localhost success does not prove
the warning has disappeared.
