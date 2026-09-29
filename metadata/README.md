# NFT metadata

The collection cover lives at `original-assets/nft/collection.png`. The 16 canonical machine images are the unmodified WebP files in `original-assets/driving-scenes/`; the road-marking and flashing-light runtime overlays are not part of those files and must not be added to NFT artwork. Names and source filenames are fixed by `original-assets/driving-scenes/manifest.json`.

Generate `collection.json` and the 16 machine JSON files only after the corresponding images have been uploaded to permanent storage:

```powershell
$env:NFT_IMAGE_URIS='https://.../collection,https://.../economy-0,...,https://.../legend-3'
npm run metadata:build
```

For the disposable mainnet validation collection, also set
`NFT_METADATA_MODE=mainnet-test`. This produces visibly separate `FARE Test ...`
names, the `FARETEST` symbol, and descriptions that explicitly state that the
assets are not production NFTs.

The generated files are written to `.qa/nft-metadata/` and are intentionally not committed. Their fixed machine order is Economy 0–3, Comfort 0–3, Business 0–3, Legend 0–3. Upload those JSON files through Irys, verify every public image/JSON URL, then set `COLLECTION_URI` and all 16 `MACHINE_METADATA_URIS` before initialization. No upload is performed by the generator.

Dynamic durability, rewards and repair cost do not belong in NFT metadata. They are read from the Solana program.
Machine JSON deliberately omits `name`: the immutable Core Asset name is assigned on-chain as `FARE <Class> #<serial>`, while the model is represented by the `Model` attribute.

The verified production metadata manifest is permanently available at:

`https://gateway.irys.xyz/9evKWgrS3Jp6cGdDD3oBMRCoy7SYJ7gb6jBupX7ZMsaE/`

Its `collection.json` and all 16 machine JSON files use symbol `FARE`, contain no disposable-test wording, and reference the canonical image manifest `DUxuuswdW5GvAaSejz35vmGa1G6S8xcjbb1EmqQamc5i`.
