# The logos, as files

Made by `npm run brand:art` (`scripts/brand-art.tsx`) from one source,
`src/lib/cardArt/logo.ts` and `seal.ts`. Do not edit these files by hand: change the source and run
the script, so the app icon, these exports, and the seal on a card's back stay the same drawing.

## A, the primary logo

The tile on the game's paper, with the eyes the letters have. It is the app icon, the browser
tab's icon, and the mini app's icon.

| File | Use |
|---|---|
| `logo-a.svg` | The drawing itself, for print and for any size. No paper grain (a grain is pixels). |
| `logo-a-1024.png` … `logo-a-16.png` | With the paper grain. 1024 and 512 for stores and listings, 192 and 180 for home screens, 64, 32, and 16 for tabs. |

## B, the seal

A gilded tile on engraved blue. Round by design: use it where a mark is stamped on something or
cut to a circle.

| File | Use |
|---|---|
| `logo-b.svg`, `logo-b-1024.png` … `logo-b-16.png` | Square, the blue to every edge. A round crop cuts nothing that matters. |
| `logo-b-round.svg`, `logo-b-round-1024.png`, `-512`, `-256` | The circle alone on a clear ground: stickers, profile pictures. |
| `logo-b-one-ink.svg` | One ink (here the game's ink, `#1b1714`), for pressing into a material or printing in one color. Its eyes are inverted for one ink: the eyeball is inked and the pupil is clear. Change the color by replacing `#1b1714` in the file. |

Under 32 px, B's engraving is too fine to see and it reads as a gold tile on blue. For a browser
tab, use A.

## The lockup

A's tile standing where the name's first letter would, then EXIGOTCHI: one word. The name's
letters are outlines of Söhne Fett, the face of the L inside the tile, so no font is needed. There
is no lockup with the seal (starl3xx, 2026-11-27).

| File | Use |
|---|---|
| `lockup.svg`, `lockup-512.png`, `lockup-128.png` | On a light ground: the name in the game's ink. The pictures have a clear ground. |
| `lockup-on-dark.svg`, `lockup-on-dark-512.png`, `lockup-on-dark-128.png` | On a dark ground: the name in the game's paper. The tile is the same. |
| `lockup-one-ink.svg`, `lockup-one-ink-on-dark.svg` | One ink, for a stamp or a single-colour print. Use the one made for the ground. |
| `name.svg`, `name-on-dark.svg` | The name alone, for a place too tight for a mark. |

Every drawing above also comes as two pictures on a clear ground, 512 and 128 px tall
(`lockup-one-ink-512.png`, `name-on-dark-128.png`, and so on). An "on dark" picture is light, so it
shows nothing on a white page.

- **The eyes never invert.** On any ground an eye is a light eyeball with a dark pupil. That is why
  one ink has two files: never recolour one to make the other.
- **Alive only where it is drawn live.** In the game and on the landing page the eyes blink and
  glance (`src/components/brand/Lockup.tsx`). These files are still.
- Where a mark must be square (an app icon, a tab, a profile picture), use A, not the lockup.

## Where B is used in the game

- The back of every card: pressed into the material in one ink (`src/lib/cardArt/seal.ts`).
- The plastic case's label, in colour.

Other places it could go (not built): round profile pictures on X, Farcaster, and Telegram; the
corner of a saved card picture and the share video; a stamp on the share picture's table; the mark
of an official Shop item; the head of the reminder emails.
