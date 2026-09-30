# Phantom dApp review package

This document describes the current public Solana mainnet rehearsal for the
Phantom dApp review team. It does not represent a production launch.

## Submission fields

### Project Name

Fare Share

### Describe your dApp

Fare Share is a non-custodial Solana dApp built around a finite collection of
ownable Metaplex Core taxi NFTs. Users can buy the test-branded FARETEST token
through a wallet-approved Jupiter transaction, mint a taxi using a short-lived
signed USD-denominated quote, receive activity-based protocol rewards, claim
supported assets, and repair vehicle durability by burning FARETEST. The
current public environment is a disposable mainnet rehearsal. Fare Share never
requests or stores user seed phrases or private keys, and all user transactions
require explicit wallet approval.

### dApp website URL

https://ownataxi.com/rehearsal/

### Project representative

Ivan Dalechenko — CTO

### Contact

- Email: ivandalechenko@gmail.com
- X: https://x.com/taxiempire
- Telegram: https://t.me/ivandalechenko

### Transaction links

Successful wallet-approved token purchase associated with a rehearsal mint:

https://solscan.io/tx/66yBtCHdcHdLYutpaPtXmRbX8xg2GW9mdGjL3Q5jnQ4FbnxxfKBA167ZDpKvbZdgVCqY8Fo8hGJDW9nqFVL98xNB

Successful custom-program NFT mint:

https://solscan.io/tx/4bLFw52UqNPg8uRJ1ToKcfsJ7FEVBuYFmV4XWaRSENY9grSfcqgnR7incioJChKkPgqo316fVEMTdh1FeAkHvwsu

### Team Information

- CTO: Ivan Dalechenko
- GitHub profile: https://github.com/f1nando
- Repository: https://github.com/f1nando/fare-share
- Product documentation: https://ownataxi.com/rehearsal/docs/

### Social Media Handles

- Official project X: https://x.com/taxiempire
- CTO Telegram: https://t.me/ivandalechenko

### Community reference

No external community reference is available at this time.

## Additional review information

We are requesting review of false-positive warnings shown during the FARETEST
buy and custom NFT mint flows on `ownataxi.com`. The domain and application are
new, and the current deployment is deliberately labelled as a rehearsal.

- The frontend uses Solana Wallet Standard and never receives a private key.
- Token purchase uses a standard Jupiter-built swap approved by the user.
- NFT mint uses the Fare Share Solana program and an ephemeral NFT asset signer;
  the user's wallet remains the fee payer and must approve the transaction.
- The backend signs only short-lived, domain-separated quote or voucher payloads;
  it cannot sign as the user.
- Payment, Metaplex Core NFT creation, and Machine PDA creation are atomic.
- The repository includes the Rust program, frontend transaction builders,
  backend validation, focused tests, architecture, and security policy.
- The Solana program has not yet completed an independent production audit.

## Rehearsal identities

- Program: `3i1YDj1ZKCypwoYqP21CzGatdPMzuRPUGrsjSxGBEp1Z`
- Collection: `DnRzC8Mgpa3EHeTgXLxWXnLCt7dRbSLegjviAq5knH6c`
- FARETEST mint: `HGLuaP3kL2AXvU8gRZmQzLCqFvKcotm1Gsw5nZSzQdCA`

Production will use separately frozen and verified identities. Reviewers may
contact Ivan Dalechenko through the email or Telegram account above for domain
verification or additional transaction evidence.
