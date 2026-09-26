# Stylized car collection / v1

## Build and preview

```sh
npm run models:build   # deterministic GLBs + measured manifest in public/models/collection
npm run dev           # open /nft.html (isolated Three.js studio)
npm run test:nft       # GLTFLoader roundtrip, budgets, coordinates and trait contract
npm run build:nft     # standalone deployable dist-nft/nft.html + assets
```

The studio loads the generated GLB, not the procedural source. Inspect nine views,
black silhouette, wireframe and 200 × 200 pixel thumbnails. Download exports the
selected visible traits. No city scene changes are needed.

## Asset contract

- Meters; Y up; forward −X; ground Y=0; centered on X/Z. Do not normalize every car
  to the same bounding box: a Range Rover must remain larger than a 911.
- Root: model identifier, e.g. `PORSCHE_911`; metadata contains version and anchors.
- Required groups: `BODY`, `WHEELS`, `GLASS`, `HEADLIGHTS`, `TAILLIGHTS`,
  `ROOF_ACCESSORY`, `FRONT_ACCESSORY`, `REAR_ACCESSORY`, `SIDE_ACCESSORY`, `DECALS`.
- Wheels: four local pivots `WHEEL_FRONT_LEFT`, `WHEEL_FRONT_RIGHT`,
  `WHEEL_REAR_LEFT`, `WHEEL_REAR_RIGHT`; local axle Z. Left is −Z.
- Material names: `Body`, `Glass`, `Black`, `Lights`, `Taillights`, `Wheels`.
- Body color: `applyTraits(root, { color: '#ffc318', taxi: true, decals: true,
  spoiler: false, wheels: 'silver' })`. Clone materials when independent instances
  share a loaded asset. Replace wheel pivot children to supply a new wheel geometry.
- Decals are removable offset planes, independent from body topology. Accessories
  are bounded groups; the library GLB contains all options. Choose defaults after
  loading. Custom downloads include only selected visible objects.

## Add a car

1. Copy the structure of `src/nft/porsche911.js`, reuse `createTemplate`, and define
   model-specific body/roof stations and axle positions. Silhouette first.
2. Check front, side, rear and top before adding lamps. Add only distinguishing
   lamps/bumpers, then accessories. Keep roofs and glazing tightly fitted.
3. Register factory in `MODELS` in `scripts/build-collection.mjs`.
4. Keep 1,500–3,000 triangles, ≤6 materials and <250 KB raw GLB. Assembly merges
   geometry by material inside each trait boundary and indexes repeated vertices.
5. Run build + focused roundtrip check; visually accept all views, silhouette and
   thumbnail readability. Adapt the root-specific test for additional models.

No raster textures are needed for this asset: color PBR + tiny planar sign glyphs.
An atlas or KTX2 would add complexity without reducing texture memory here. GLB is
uncompressed and works with stock GLTFLoader, without decoder downloads. Enable
HTTP Brotli/gzip on hosting. Add meshopt at collection delivery time only if measured
transfer savings outweigh decoder overhead; keep a source GLB and test the compressed
roundtrip. Instancing/caching for mass display belongs in the consuming scene.

The source generator is the editable production asset. Output GLBs and manifest are
committed for immediate use. No Blender installation or external asset service is needed.
