# Fare Share

<p align="center">
  <img src="public/brand/fare-driver.png" alt="Fare Share taxi driver" width="520" />
</p>

**An onchain taxi park on Solana.** Fare Share combines a finite collection of
ownable taxi NFTs, activity-based reward accounting, five-day vehicle durability,
trainee campaigns, and wallet-controlled trading through Jupiter.

> **Development status:** Fare Share is under active development and is not yet a
> production release. The public site currently contains a disposable mainnet
> rehearsal that uses test-branded assets. Rehearsal tokens and NFTs are not the
> future production assets, and no fixed return or profit is promised.

[Website](https://ownataxi.com/) · [Mainnet rehearsal](https://ownataxi.com/rehearsal/) ·
[Product documentation](https://ownataxi.com/rehearsal/docs/) ·
[X / Twitter](https://x.com/taxiempire)

## Concept

Fare Share represents a taxi fleet as Metaplex Core NFTs. A paid taxi remains in
its owner's wallet while a Solana program account tracks its class weight,
durability, reward checkpoints, and claimable balances. The Solana program—not
the backend database—is the source of truth for ownership and financial state.

The product loop is:

```text
Mint a taxi → keep it active → protocol fees fund reward pools
→ calculate rewards → claim assets → repair the taxi → repeat
```

Rewards come only from assets the protocol actually receives. Fare Share does
not mint synthetic yield, promise a fixed APY, or create debt when a swap route
is unavailable.

## Taxi collection

The planned paid collection contains exactly **1,222** transferable taxis:

| Class | Supply | Weight | Initial share |
|---|---:|---:|---:|
| Economy | 833 | 1 | 68.17% |
| Comfort | 278 | 3 | 22.75% |
| Business | 83 | 10 | 6.79% |
| Legend | 28 | 30 | 2.29% |

- Each class has four vehicle models, for 16 paid NFT variants in total.
- Users do not select a class or model.
- The complete assignment order is shuffled before sale and committed onchain
  through a Merkle root.
- Each mint consumes the next valid assignment and must provide its Merkle proof.
- The frontend displays live odds from the remaining supply rather than static
  launch percentages.
- Burning an NFT does not reopen its place in the fixed collection.
- Paid taxis have 0% project creator royalties and remain transferable.

Each paid mint has a target price of **$25**, settled in the configured `$FARE`
token. Immediately before minting, the backend checks live market liquidity and
signs a short-lived quote bound to the wallet, asset, assignment, token mint,
raw amount, and deployment. Payment, NFT creation, and Machine account creation
then succeed or fail atomically in one Solana transaction.

## Rewards and protocol fees

Fare Share is designed around the actual variable creator fees received from the
configured pump.fun token. Collected SOL is separated into the following paths:

| Allocation | Purpose |
|---:|---|
| 45% | Buy `$FARE` for the paid taxi fleet |
| 5% | Buy `$FARE` for trainee campaigns |
| 20% | Buy and burn `$FARE` |
| 5% each | Buy `UBERx`, `TSLAx`, `GOOGLx`, and `AMZNx` |
| 10% | Project team |

Each asset is processed independently through a validated Jupiter route. If a
route is unavailable or fails safety checks, that allocation remains reserved;
it does not block successful assets or become an artificial obligation.

Rewards are split by **active time × class weight**. Mint, repair, expiry, and
burn events divide time into deterministic accounting segments. Permissionless
calculation calls advance bounded event batches and update cumulative reward per
weight. This avoids iterating over all 1,222 taxis in one transaction.

A claim transfers only rewards already calculated for that taxi. Claim order
does not change another owner's allocation. Unclaimed rewards belong to the taxi
account and follow the NFT when ownership changes.

## Durability and repair

Every paid taxi starts with five days of durability. Once durability reaches
zero, its weight leaves the active fleet and it stops earning until repaired.

A repair:

1. settles rewards through the current calculated boundary;
2. burns the required `$FARE` from the current owner;
3. restores five full days from the repair time;
4. schedules new activation and expiry events atomically.

The repair price is derived from the taxi's calculated `$FARE` activity since
its previous mint or repair. Claiming rewards does not restore durability.

## Trainee campaigns

Trainee campaigns provide a separate onboarding path:

- the backend validates a campaign code and issues an expiring signed voucher;
- the Solana program verifies the voucher and prevents reuse;
- activation creates a visible Metaplex Core NFT and a unique
  `wallet + campaign` account;
- the trainee NFT is permanently frozen and cannot be transferred or repaired;
- trainees participate only in their separate 5% `$FARE` pool;
- participation ends automatically at the voucher-defined time.

The backend signature authorizes campaign eligibility only. It never gives the
backend access to the user's wallet or private keys.

## Trade, Garage, and public data

- **Mint** prepares live `$FARE` pricing and creates a paid taxi.
- **Garage** shows finalized ownership, durability, and claimable assets and
  supports atomic batch claim and repair transactions.
- **Trade** obtains Jupiter quotes and builds wallet-approved `$FARE` buy/sell
  transactions. User keys never reach the server.
- **Leaderboard and public pages** read a recoverable MongoDB projection built
  from finalized Solana and DAS state.
- **Market** links to the official external marketplace rather than implementing
  a custodial marketplace.

## Trust model and safety boundaries

- Users sign transactions in their own Solana wallet through Wallet Standard.
- Fare Share never requests or stores a user's seed phrase or private key.
- Solana PDA state is authoritative; MongoDB stores campaigns, operational
  settings, audit records, and rebuildable public read models.
- Mint quotes, trainee vouchers, and swap plans are domain-separated, expiring,
  and bound to exact transaction data.
- External transactions are simulated where applicable and accepted only after
  finalized confirmation.
- Jupiter routes are constrained by input amount, minimum output, deadline,
  nonce, approved program, and route-account hash.
- Admin routes use server-side sessions, CSRF protection, origin checks, request
  limits, and secrets stored outside the repository.
- A global pause blocks mint, claim, repair, reward, and swap operations.
- The current design has an upgrade authority and a trusted emergency admin.
  During a pause, that admin can rescue protocol-controlled vault assets. This
  is an explicit trust assumption, not a trustless guarantee.
- The Solana program has not yet completed an independent production audit.

See [SECURITY.md](SECURITY.md) for responsible disclosure.

## Current public rehearsal

The current environment is a disposable **Solana mainnet rehearsal**, not the
production launch:

| Item | Address |
|---|---|
| Program | `3i1YDj1ZKCypwoYqP21CzGatdPMzuRPUGrsjSxGBEp1Z` |
| Collection | `DnRzC8Mgpa3EHeTgXLxWXnLCt7dRbSLegjviAq5knH6c` |
| Test token (`FARETEST`) | `HGLuaP3kL2AXvU8gRZmQzLCqFvKcotm1Gsw5nZSzQdCA` |

Production will use a separately frozen and verified program deployment,
collection, token, keyset, configuration manifest, and release artifact.
Rehearsal identifiers must not be treated as future production addresses.

## Architecture

Fare Share is a modular application rather than a set of microservices:

```text
programs/taxi_park/   Rust/Anchor Solana program
src/                  React/Vite frontend and Solana client
src/city/             Three.js procedural city background
server/               Node.js/TypeScript API, indexer, admin, and worker logic
scripts/              Setup, verification, rehearsal, and recovery tools
tests/                Focused frontend, backend, protocol, and simulation tests
docs/                 Architecture, operations, scenarios, and release gates
```

Core technologies:

- Solana, Rust, Anchor, PDA accounts, SPL Token and Token-2022
- Metaplex Core NFTs and DAS ownership discovery
- React 19, Vite, Three.js, Wallet Standard, and `@solana/kit`
- Node.js, TypeScript, MongoDB, Helius, Jupiter, and pump.fun integrations

For implementation detail, see [ARCHITECTURE.md](ARCHITECTURE.md). Historical
procedural-city and development notes remain available in
[docs/CITY-SIMULATION.md](docs/CITY-SIMULATION.md).

## Local development

Requirements:

- Node.js `20.19+` or `22.12+`
- npm
- Rust/Anchor tooling only when building or testing the Solana program
- MongoDB only for backend features; the frontend can run independently

```sh
npm install
copy .env.example .env
npm run dev
```

The frontend starts without a live backend. To run backend-dependent features:

```sh
npm run dev:server
```

Never place real keys in `.env.example`, frontend `VITE_*` variables, logs, or
the repository.

## Focused verification

```sh
npm run build
npm run server:typecheck
npm run test:backend
node --test tests/protocol-client.test.js
cargo test --manifest-path programs/taxi_park/Cargo.toml
```

CI runs Node checks, the frontend build, backend tests, protocol-client tests,
and Rust unit tests without deployment credentials. Deployment and mainnet
transactions are never part of normal CI.

## Documentation

- [Architecture](ARCHITECTURE.md)
- [Backend and worker](docs/BACKEND.md)
- [Scenario tests](docs/SCENARIO-TESTS.md)
- [Application readiness](docs/APP-READINESS-CHECKLIST.md)
- [Deployment and recovery](DEPLOY.md)
- [Final launch plan](docs/FINAL-LAUNCH-PLAN.md)
- [Procedural city implementation notes](docs/CITY-SIMULATION.md)

Some internal engineering and operations documents are currently written in
Russian. The public product interface and new public-facing documentation are
English-only.

## Project contact

- **Ivan Dalechenko — CTO**
- **Email:** [ivandalechenko@gmail.com](mailto:ivandalechenko@gmail.com)
- **Official X:** [@taxiempire](https://x.com/taxiempire)

## License

No open-source license has been selected yet. Source availability does not grant
permission to copy, modify, distribute, or deploy the project. A license will be
added before the repository is intentionally published as open source.
