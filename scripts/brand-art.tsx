/**
 * The game's marks as files: the app's icons, and the exports in docs/brand.
 *
 *   npm run brand:art
 *
 * One source draws them all (src/lib/cardArt/logo.ts for A and B in colour, seal.ts for B in one
 * ink), so the icon, the exports, and the seal on a card's back can't drift apart.
 *
 * - **A, the primary logo,** is the app icon. Its pictures carry a paper grain on the cream field
 *   and the tile's face (docs/icon/make_grain.py makes it, seeded, and this script runs it when
 *   the grain is missing). A's SVG is the drawing alone, with no grain: a grain is pixels.
 * - **B, the seal,** square, round with a clear ground, and in one ink.
 *
 * Pictures are drawn by Playwright's Chromium, each at its own size (a small icon is drawn small,
 * not shrunk from a big one). No font is needed: the letter is its own outline.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { svgDoc } from "../src/lib/cardArt/engrave";
import { EMAIL_MARK, LOGO, logoA, logoB, lockup, nameAlone } from "../src/lib/cardArt/logo";
import { SEAL, sealInk } from "../src/lib/cardArt/seal";

const ROOT = process.cwd();
const ICON = join(ROOT, "docs", "icon");
const OUT = join(ROOT, "docs", "brand");
const INK = "#1b1714";
/** Every square size asked for: a store listing down to a browser tab. */
const SIZES = [1024, 512, 192, 180, 64, 32, 16];
const ROUND_SIZES = [1024, 512, 256];
/** The lockup's pictures, by height: a banner, and a header. */
const LOCKUP_HEIGHTS = [512, 128];
/** The grain's strength over A (docs/icon). */
const GRAIN_OPACITY = 0.07;

const uri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const grainPath = join(ICON, "grain.png");
  if (!existsSync(grainPath)) {
    console.log("making the paper grain (docs/icon/make_grain.py)…");
    execFileSync("python3", ["make_grain.py"], { cwd: ICON, stdio: "inherit" });
  }
  const grain = `data:image/png;base64,${readFileSync(grainPath).toString("base64")}`;

  const a = svgDoc(logoA(), LOGO, LOGO);
  const b = svgDoc(logoB(), LOGO, LOGO);
  const bRound = svgDoc(logoB({ round: true }), LOGO, LOGO);
  const bInk = svgDoc(sealInk(INK), SEAL, SEAL);
  // The lockup (the tile that is the name's L, then EXIGOTCHI) and the name alone: on a light ground, on a dark one, and in one ink.
  const doc = (l: { markup: string; width: number; height: number }) => svgDoc(l.markup, l.width, l.height);
  const svgs: [string, string][] = [
    ["logo-a.svg", a], ["logo-b.svg", b], ["logo-b-round.svg", bRound], ["logo-b-one-ink.svg", bInk],
    ["lockup.svg", doc(lockup())], ["lockup-on-dark.svg", doc(lockup({ tone: "dark" }))],
    ["lockup-one-ink.svg", doc(lockup({ oneInk: true }))], ["lockup-one-ink-on-dark.svg", doc(lockup({ tone: "dark", oneInk: true }))],
    ["name.svg", doc(nameAlone())], ["name-on-dark.svg", doc(nameAlone("dark"))],
  ];
  for (const [name, svg] of svgs) writeFileSync(join(OUT, name), svg + "\n");

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  /** One picture: the drawing at `size`, with the grain over it when asked, on a clear ground. */
  const shot = async (svg: string, size: number, file: string, withGrain = false) => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<body style="margin:0;background:transparent"><img src="${uri(svg)}" style="position:absolute;left:0;top:0;width:${size}px;height:${size}px">${
        withGrain ? `<img src="${grain}" style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;opacity:${GRAIN_OPACITY}">` : ""
      }</body>`,
    );
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
    await page.screenshot({ path: file, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  };

  for (const size of SIZES) {
    await shot(a, size, join(OUT, `logo-a-${size}.png`), true);
    await shot(b, size, join(OUT, `logo-b-${size}.png`));
  }
  for (const size of ROUND_SIZES) await shot(bRound, size, join(OUT, `logo-b-round-${size}.png`));

  // The emails' header (lib/notify/email): the lockup on the card's own paper, three pixels to the point. The paper
  // is IN the picture: a clear ground would vanish in a mail program that turns a page dark.
  {
    const l = lockup();
    const height = EMAIL_MARK.height * 3;
    const width = EMAIL_MARK.width * 3;
    await page.setViewportSize({ width, height });
    await page.setContent(`<body style="margin:0;background:${EMAIL_MARK.paper}"><img src="${uri(doc(l))}" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px"></body>`);
    await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
    mkdirSync(join(ROOT, "public", "brand"), { recursive: true });
    await page.screenshot({ path: join(ROOT, "public", "brand", "lockup-email.png"), clip: { x: 0, y: 0, width, height } });
  }
  // The player docs' logo (docs-site/docs.json): the same two drawings, where the docs platform reads them.
  mkdirSync(join(ROOT, "docs-site", "logo"), { recursive: true });
  writeFileSync(join(ROOT, "docs-site", "logo", "lockup.svg"), doc(lockup()) + "\n");
  writeFileSync(join(ROOT, "docs-site", "logo", "lockup-on-dark.svg"), doc(lockup({ tone: "dark" })) + "\n");

  // The lockup and the name alone as pictures, on a clear ground: every drawing, at each height.
  const wide: [string, { markup: string; width: number; height: number }][] = [
    ["lockup", lockup()], ["lockup-on-dark", lockup({ tone: "dark" })],
    ["lockup-one-ink", lockup({ oneInk: true })], ["lockup-one-ink-on-dark", lockup({ tone: "dark", oneInk: true })],
    ["name", nameAlone()], ["name-on-dark", nameAlone("dark")],
  ];
  for (const [name, l] of wide) {
    for (const height of LOCKUP_HEIGHTS) {
      const width = Math.round((height * l.width) / l.height);
      await page.setViewportSize({ width, height });
      await page.setContent(`<body style="margin:0;background:transparent"><img src="${uri(doc(l))}" style="position:absolute;left:0;top:0;width:${width}px;height:${height}px"></body>`);
      await page.waitForFunction(() => Array.from(document.images).every((i) => i.complete && i.naturalWidth > 0));
      await page.screenshot({ path: join(OUT, `${name}-${height}.png`), omitBackground: true, clip: { x: 0, y: 0, width, height } });
    }
  }

  // The app's own icons are A (src/app/icon-image, the manifest, the tab's icon, the docs' favicon).
  for (const [size, file] of [[1024, "public/icon.png"], [512, "public/icon-512.png"], [192, "public/icon-192.png"], [192, "docs-site/favicon.png"]] as const) {
    await shot(a, size, join(ROOT, file), true);
  }
  await browser.close();
  console.log(`wrote ${svgs.length} SVGs and ${SIZES.length * 2 + ROUND_SIZES.length + wide.length * LOCKUP_HEIGHTS.length} pictures to docs/brand, and the app's 4 icons`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
