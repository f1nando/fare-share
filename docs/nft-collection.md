# Stylized car collection

The collection currently has no registered cars or preview page.

Reusable assembly helpers remain in `src/nft/collection.js`. Register model
factories in `MODELS` in `scripts/build-collection.mjs`, then run
`npm run models:build` to export GLBs and a measured manifest into
`public/models/collection/`.

## Asset contract

- Meters, Y up, forward −X, ground Y=0, centered on X/Z.
- Root name is the model identifier; metadata contains version and anchors.
- Groups: `BODY`, `WHEELS`, `GLASS`, `HEADLIGHTS`, `TAILLIGHTS`,
  `ROOF_ACCESSORY`, `FRONT_ACCESSORY`, `REAR_ACCESSORY`, `SIDE_ACCESSORY`, `DECALS`.
- Four replaceable wheel pivots: `WHEEL_FRONT_LEFT`, `WHEEL_FRONT_RIGHT`,
  `WHEEL_REAR_LEFT`, `WHEEL_REAR_RIGHT`. Local axle Z; left is −Z.
- Materials: `Body`, `Glass`, `Black`, `Lights`, `Taillights`, `Wheels`.
- `applyTraits` controls body color, wheel finish and accessory visibility.
  Clone materials when independent instances share a loaded asset.
- `optimizeParts` merges and indexes geometry inside each trait boundary.

## Visual standard

Target clean, smooth, stylized collectible cars. Establish a recognizable body,
roof, glass and wheel silhouette before adding lights or NFT accessories.
Use smooth shading, rounded transitions and appropriate normals. There is no
fixed 3,000-triangle limit: measure and optimize after visual acceptance.

Check front, side, rear, three-quarter views and small thumbnails. Validate each
new model by exporting and loading it with `GLTFLoader`. Keep the editable source
generator alongside the generated GLB and manifest.
