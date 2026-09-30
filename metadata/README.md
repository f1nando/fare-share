# NFT metadata

The collection cover lives at `original-assets/nft/collection.png`. The 16 canonical machine images are the unmodified WebP files in `original-assets/driving-scenes/`; the road-marking and flashing-light runtime overlays are not part of those files and must not be added to NFT artwork. Names and source filenames are fixed by `original-assets/driving-scenes/manifest.json`. The exact trainee artwork is `public/nft/trainee.png` (SHA-256 `d3c890f40fdc2fae60199a8a9328aeb9065b9d09f4027c844c66fa09c05063f0`).

Generate `collection.json`, the 16 machine JSON files and `trainee.json` only after all 18 corresponding images have been uploaded to permanent storage:

```powershell
$env:NFT_IMAGE_URIS='https://.../collection,https://.../economy-0,...,https://.../legend-3,https://.../trainee'
npm run metadata:build
```

For the disposable mainnet validation collection, also set
`NFT_METADATA_MODE=mainnet-test`. This produces visibly separate `TAXI Test ...`
names, the `TAXITEST` symbol, and descriptions that explicitly state that the
assets are not production NFTs.

The generated files are written to `.qa/nft-metadata/` and are intentionally not committed. Their fixed machine order is Economy 0–3, Comfort 0–3, Business 0–3, Legend 0–3, followed by trainee. Upload those JSON files through Irys, verify every public image/JSON URL, then set `COLLECTION_URI`, all 16 `MACHINE_METADATA_URIS`, and `TRAINEE_METADATA_URI` before initialization. No upload is performed by the generator.

Dynamic durability, rewards and repair cost do not belong in NFT metadata. They are read from the Solana program.
Machine JSON deliberately omits `name`: the immutable Core Asset name is assigned on-chain as `TAXI <Class> #<serial>`, while the model is represented by the `Model` attribute. The trainee asset is named `TAXI Trainee`, uses a permanent frozen-transfer plugin, and has no repair path.

The legacy test metadata manifest is permanently available at:

`https://gateway.irys.xyz/9evKWgrS3Jp6cGdDD3oBMRCoy7SYJ7gb6jBupX7ZMsaE/`

It must not be reused by the new production collection. The new manifest uses symbol `TAXI` and includes the trainee metadata.
