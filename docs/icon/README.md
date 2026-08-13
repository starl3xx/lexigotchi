# The app icon

`public/icon.png` (1024×1024, served at `/icon-image`) is a **pre-rendered** asset, not a
Satori render — the grain mask and per-band gradients are beyond `next/og`. This directory
is its canonical source. The design was iterated in Paper and locked on 2026-08-12.

## Recipe

The glow-up tile as an enamel-pin-style character on ticket-stub paper:

- **Field** — flat cream `#f4ead2`, no gradient.
- **Tile skin** — the two non-negotiable blue borders: pale ring `#bbd1fd` outside LHAW blue
  `#3b82f6`, white face inside; each band gets its own top-lit vertical gradient. No ink
  outline, no spec highlight.
- **Edge** — wood extrusion `#b69c72 → #a1865c`, offset (5, 10), drawn as a swept hull with
  straight diagonal connector edges at the silhouette tangents (thickness, not shadow).
- **Grain** — two-scale paper noise, 7% opacity, native 1024, masked in the texture's alpha to
  the cream field and white face only. Blue borders, wood edge, eyes, and brows stay clean.
- **Character** — pie-cut eyes overlap the frame; left brow arched 4.5 units higher; pupils
  glancing 3 units right (deliberate asymmetry). Letter is Söhne Fett (800) `#111827`,
  optically centered 7 units high. Whole character mass centered brows-to-edge, then raised
  8 units; every corner clears a circle crop.

## Regenerating

Deterministic (the grain is seeded). Requires Söhne Fett installed locally and Chrome.

```sh
python3 make_grain.py       # → grain.png   (masked paper texture, ~1.2 MB)
python3 build_source.py     # → source.html (self-contained icon source)
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --hide-scrollbars \
  --force-device-scale-factor=2 --window-size=512,512 \
  --screenshot=icon-1024.png "file://$PWD/source.html"
cp icon-1024.png ../../public/icon.png
```

Geometry lives in 512-space in `build_source.py` (the SVG) and `make_grain.py` (the grain
mask must match it — if you move the tile, move both). Outputs are gitignored; only
`public/icon.png` is tracked.
