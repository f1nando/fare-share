# Phantom dApp review package

This document describes the current Fare Share production deployment on Solana
mainnet for the Phantom dApp review team.

## Submission fields

### Project Name

Fare Share

### Describe your dApp

Fare Share is a non-custodial Solana dApp built around a finite collection of
1,222 ownable Metaplex Core taxi NFTs. Users can trade TAXI through
wallet-approved Pump.fun transactions, mint a taxi using a short-lived signed
USD-denominated quote, receive activity-based protocol rewards, claim supported
assets, and repair vehicle durability by burning TAXI. Fare Share never requests
or stores user seed phrases or private keys, and all user transactions require
explicit wallet approval.

### dApp website URL

https://ownataxi.com/

### Project representative

Ivan Dalechenko — CTO

### Contact

- Email: ivandalechenko@gmail.com
- X: https://x.com/taxiempire
- Telegram: https://t.me/ivandalechenko

### Transaction links

Successful production custom-program NFT mint:

https://solscan.io/tx/REV4vebghECi4qtujKaisyWMuhR3RUJjLgkj67oaGrd29vKLwJHrCzUoQqJhSFSdAwW1U3ehAxcGEEiNaFBE1Hz

### Team Information

- CTO: Ivan Dalechenko
- GitHub profile: https://github.com/f1nando
- Repository: https://github.com/f1nando/fare-share
- Product documentation: https://ownataxi.com/docs/

### Social Media Handles

- Official project X: https://x.com/taxiempire
- CTO Telegram: https://t.me/ivandalechenko

### Community reference

No external community reference is available at this time.

## Additional review information

We are requesting review of a false-positive warning shown during the production
custom NFT mint flow on `ownataxi.com`. Phantom displays “This dApp could be
malicious” even though the transaction passes RPC simulation before the wallet
request.

- The frontend uses Solana Wallet Standard and never receives a private key.
- NFT mint uses the Fare Share Solana program and an ephemeral NFT asset signer;
  the user's wallet remains the fee payer and must approve the transaction.
- Phantom signs the transaction first with `signTransaction`; the ephemeral
  asset signature is added only after the wallet returns the signed bytes.
- The transaction uses a mainnet Address Lookup Table and remains below Solana's
  1,232-byte wire limit.
- The exact unsigned transaction is simulated with `sigVerify: false` before it
  is passed to Phantom, and a failed simulation is never shown for approval.
- The backend signs only short-lived, domain-separated quote or voucher payloads;
  it cannot sign as the user.
- Payment, Metaplex Core NFT creation, and Machine PDA creation are atomic.
- The repository includes the Rust program, frontend transaction builders,
  backend validation, focused tests, architecture, and security policy.
- The Solana program has not yet completed an independent production audit.

## Production identities

- Program: `8Z9Mru23DFLJGFsDH7tPAfD289JSC4SABt81rqhrYwxD`
- Collection: `Ebcwoz2G7qb3o2ZP4HsCcHysQ2EQ4q6MDJdnA5mTRXpm`
- TAXI mint: `C4TZajXpTPg7MP7VWuPXjSTDzyPvPgHVJjxC9dBZNKrj`
- Address Lookup Table: `DyChCqg6MV2QmP2YGX19Ai9nEGriydCVFeiLigDLGRQn`

Reviewers may contact Ivan Dalechenko through the email or Telegram account
above for domain verification or additional transaction evidence.
