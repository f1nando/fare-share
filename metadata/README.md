# NFT metadata

The four class images and the collection cover live in `public/nft/`.

Generate the five final JSON files only after the corresponding images have been uploaded to permanent storage:

```powershell
$env:NFT_IMAGE_URIS='https://.../collection,https://.../economy,https://.../comfort,https://.../business,https://.../legend'
npm run metadata:build
```

The generated files are written to `.qa/nft-metadata/` and are intentionally not committed. Upload those JSON files through Irys, verify every public image/JSON URL, then set `COLLECTION_URI` and `MACHINE_METADATA_URIS` before initialization.

Dynamic durability, rewards and repair cost do not belong in NFT metadata. They are read from the Solana program.
