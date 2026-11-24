/**
 * Screenshots of the real game for the player docs (docs-site/images/screen-*.jpg).
 *
 *   NEXT_PUBLIC_CHAIN_ID= npm run dev          # practice (mock) mode: seeded bag, no wallet
 *   npm run docs:shots [-- http://localhost:3000/play]
 *
 * Always practice mode with no wallet, so no real address or balance is ever pictured. The Next dev
 * badge and the practice-only "Skip a day" button are hidden. The $WORD shot is cropped below the
 * price header, which changes with the swap.
 */
import { chromium } from "playwright";
import { join } from "node:path";

const url = process.argv[2] ?? "http://localhost:3000/play";
const out = join(process.cwd(), "docs-site", "images");
const W = 1200, H = 780;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1.5, reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(url, { waitUntil: "load" });
await page.waitForSelector("header", { timeout: 60_000 });
await page.waitForTimeout(1500);
const skip = page.getByRole("button", { name: "Skip", exact: true }); // the intro, on a fresh profile
if (await skip.count()) await skip.first().click();
await page.addStyleTag({ content: 'nextjs-portal,[aria-label="Skip a day"]{display:none!important}' });

const shot = (file, clip) => page.screenshot({ path: join(out, `screen-${file}.jpg`), type: "jpeg", quality: 82, clip });

for (const [name, file] of [["Today", "today"], ["Bag", "bag"], ["Showcase", "showcase"], ["Bounty", "bounty"], ["$WORD", "word"]]) {
  const item = page.locator("nav").getByRole("button", { name, exact: true }).or(page.locator("nav").getByRole("link", { name, exact: true }));
  if (!(await item.count())) throw new Error(`no rail item "${name}"`);
  await item.first().click();
  await page.waitForTimeout(name === "$WORD" ? 4000 : 1500);
  if (file === "showcase") {
    for (const ch of "great") {
      await page.locator("main button").filter({ hasText: new RegExp(`^${ch}`) }).first().click();
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(600);
  }
  if (file === "word") {
    const supply = await page.getByText("Supply", { exact: true }).first().boundingBox();
    const main = await page.locator("main").first().boundingBox();
    const top = Math.max(0, supply.y - 27);
    await shot(file, { x: main.x, y: top, width: main.width, height: H - top });
  } else {
    await shot(file);
  }
  console.log(`wrote docs-site/images/screen-${file}.jpg`);
}
await browser.close();
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
