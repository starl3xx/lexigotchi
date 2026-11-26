# The app icon

`public/icon.png` (1024×1024, served at `/icon-image`), `public/icon-512.png`,
`public/icon-192.png`, and `docs-site/favicon.png` are **pre-rendered** pictures, not Satori
renders: the grain mask and the gradients in each band are beyond `next/og`. They are logo A, the
primary logo (docs/brand has both logos as files).

The design was iterated in Paper and locked on 2026-08-12. On 2026-11-26 it got the eyes the
letters have had since the letter review (decisions.md #28): tall ovals, one big pupil each with
its pie cut, and no brows at rest. Nothing else moved.

## Recipe

The glow-up tile as an enamel-pin-style character on ticket-stub paper:

- **Field:** flat cream `#f4ead2`, no gradient.
- **Tile skin:** the two blue borders that are not up for change: a pale ring `#bbd1fd` outside
  LHAW blue `#3b82f6`, a white face inside; each band has its own top-lit vertical gradient. No ink
  outline, no spec highlight.
- **Edge:** a wood extrusion `#b69c72 → #a1865c`, offset (5, 10), drawn as a swept hull with
  straight diagonal connector edges at the silhouette tangents (thickness, not shadow).
- **Grain:** two-scale paper noise, 7% opacity, native 1024, masked in the texture's alpha to the
  cream field and the white face only. The blue borders, the wood edge, and the eyes stay clean.
- **Character:** the letters' own eyes, overlapping the frame. The letter is Söhne Fett's "L",
  `#111827`, drawn as its own outline (in that face it is a plain polygon), so no font is needed.
  Every corner clears a circle crop.

## Where the drawing lives

- `src/lib/cardArt/logo.ts` is the source: `logoA()` (and `LOGO_A`, its measures), `logoB()`.
- `make_grain.py` (here) makes the masked paper texture. Its mask repeats `LOGO_A`'s numbers: if the
  tile or the eyes move in `logo.ts`, move them there too (`tests/logo.test.ts` compares the two).

## Regenerating

Deterministic (the grain is seeded). Needs Python 3 and the project's Playwright Chromium.

```sh
npm run brand:art     # makes grain.png if it is missing, then every icon and export
```

To remake the grain itself (after the mask changes): `python3 make_grain.py` in this folder, then
`npm run brand:art`. `grain.png` is gitignored (about 1.2 MB); the icons made from it are tracked.
