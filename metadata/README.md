# NFT metadata

The original four class images and collection cover live in `original-assets/nft/`.
Optimized 1024×1024 WebP copies used by the frontend live in `public/nft/` and are not the canonical NFT metadata sources.

Generate the five final JSON files only after the corresponding images have been uploaded to permanent storage:

```powershell
$env:NFT_IMAGE_URIS='https://.../collection,https://.../economy,https://.../comfort,https://.../business,https://.../legend'
npm run metadata:build
```

The generated files are written to `.qa/nft-metadata/` and are intentionally not committed. Upload those JSON files through Irys, verify every public image/JSON URL, then set `COLLECTION_URI` and `MACHINE_METADATA_URIS` before initialization.

Dynamic durability, rewards and repair cost do not belong in NFT metadata. They are read from the Solana program.
