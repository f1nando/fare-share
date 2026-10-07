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

## Mainnet publication — 2026-10-07

- Explicit owner authorization; release source `e4c26a7` includes paid-mint
  implementation `9209f34` and local Core validation `bc51385`.
- Two bulk CLI uploads failed before upgrade; each buffer was closed separately
  and its rent returned to `F3jK…n8tR`. The mainnet Program was never closed.
- Sequential uploader confirmed 980 writes and the full buffer ELF hash at
  finalized commitment. Upgrade from the verified buffer succeeded:
  `2ABZqhkyyF25u3gEtG45UBraNtB96LTJ2SW1CcGWqTVqVMVwUrheK9z56tJ6WDYF8AjopWdLWW5WvH81mddw6SkU`.
- Finalized on-chain ELF: 881,680 bytes, SHA-256
  `124147cf9ba9683aad0943c8806e4eae976b6a2b98c4963b4c8803e33ab5f21e`.
- Program/ProgramData/collection unchanged; upgrade authority remains
  `F3jKZokibZiN5SJM5JM4T3a99HVb4zueDTGPR5hbn8tR`.
  ProgramData rent remains **4.481682680 SOL**; buffer is absent at finalized.
- Wallet after all attempts: **5.794095259 SOL**, versus **5.803576585 SOL** before
  the first attempt. Total fees: **0.009481326 SOL**. No buffer rent was lost.
- Post-upgrade recovery audit PASS; vault token amounts and reward obligations
  unchanged, minted supply still `[1,1,0,0]`. Permanent worker remains disabled.
- Backend switched first, then frontend. Health and browser mint-page smoke PASS;
  browser owner-only quote returned HTTP 200 and the canonical PDA.
- Mainnet simulations encoded one signer, 817 bytes for the admin and 849 bytes
  for the user's wallet with the existing ALT. Both reached payment validation
  but rejected insufficient TAXI balance (6062); **these are not successful mint
  simulations**. No paid mint or token purchase was submitted. Core CPI happy path
  remains validated on localhost, not in a newly submitted mainnet mint.
- Phantom warning removal is still unverified and requires an actual wallet test.
