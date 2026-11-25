/**
 * Screenshots of the real game for the player docs (docs-site/images/screen-*.jpg).
 *
 *   NEXT_PUBLIC_CHAIN_ID= npm run dev          # practice (mock) mode: seeded bag, no wallet
 *   npm run docs:shots [-- http://localhost:3000/play] [today bag showcase bounty word earnings profile]
 *
 * Names after the URL remake only those shots; with none, it remakes them all. Always practice
 * mode, so no real address or balance is ever pictured. The Next dev badge and the practice-only
 * "Skip a day" button are hidden. The $WORD shot is cropped below the price header, which changes
 * with the swap.
 *
 * The profile shot needs the server started with profiles and X on (any values work locally, and
 * point DATABASE_URL at a local database, never production):
 *
 *   PROFILES_ENABLED=true PROFILE_SESSION_SECRET=$(openssl rand -hex 32) X_CLIENT_ID=docs \
 *     X_CLIENT_SECRET=docs EMAIL_ENABLED=true RESEND_API_KEY=docs EMAIL_FROM=docs@example.invalid \
 *     DATABASE_URL=postgresql://localhost/<local db> NEXT_PUBLIC_CHAIN_ID= npm run dev
 *
 * (The email values only make the email card show; nothing here sends an email.)
 *
 * It connects a pretend wallet with a made-up address (DOCS_WALLET), which answers only the
 * account and chain questions, so it can't sign or send anything.
 */
import { chromium } from "playwright";
import { join } from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => /^https?:\/\//.test(a)) ?? "http://localhost:3000/play";
const only = args.filter((a) => !/^https?:\/\//.test(a));
const want = (file) => only.length === 0 || only.includes(file);
const DOCS_WALLET = "0x1234567890AbcdEF1234567890aBcdef12345678";
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
  if (!want(file)) continue;
  const item = page.locator("nav").getByRole("button", { name, exact: true }).or(page.locator("nav").getByRole("link", { name, exact: true }));
  if (!(await item.count())) throw new Error(`no rail item "${name}"`);
  await item.first().click();
  await page.waitForTimeout(name === "$WORD" ? 4000 : 1500);
  if (file === "showcase") {
    // CRANE, three letters raised, standing in Spring: a word, its scene, and the picker in one picture.
    await page.getByRole("radio", { name: "CRANE", exact: true }).click();
    await page.getByRole("radio", { name: "Spring", exact: true }).click();
    await page.waitForTimeout(800);
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
// Your earnings: feed the hungry VIVID, let a practice day pass so it earns, and open the sheet from
// the line under the stage. Last of the practice shots, because it changes the practice game.
if (want("earnings")) {
  await page.locator("nav").getByRole("button", { name: "Today", exact: true }).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole("button", { name: /Feed VIVID/ }).first().click();
  await page.waitForTimeout(800);
  // The skip button is hidden from the pictures above, so press it without showing it.
  await page.locator('[aria-label="Skip a day"]').first().dispatchEvent("click");
  // The new day's toasts hold for up to 6 s (primitives.tsx toastMs); let them go before the picture.
  await page.waitForTimeout(6500);
  await page.getByRole("button", { name: /Your words earned/ }).first().click();
  await page.waitForTimeout(1200);
  await shot("earnings");
  console.log("wrote docs-site/images/screen-earnings.jpg");
}

// Your profile, with a wallet connected and nothing linked: the state a new player sees.
if (want("profile")) {
  const config = await fetch(new URL("/api/profile/config", url)).then((r) => r.json()).catch(() => null);
  if (!config?.x) {
    console.error("skipped screen-profile.jpg: start the server with profiles and X on (see the top of this file)");
    if (only.includes("profile")) process.exitCode = 1;
  } else {
    const p = await browser.newPage({ viewport: { width: W, height: 1080 }, deviceScaleFactor: 1.5, reducedMotion: "reduce" });
    p.on("pageerror", (e) => errors.push(String(e)));
    // An EIP-6963 wallet that knows only its address and Base, so the game connects to it on load.
    await p.addInitScript((addr) => {
      const provider = {
        request: async ({ method }) => {
          if (method === "eth_requestAccounts" || method === "eth_accounts") return [addr];
          if (method === "eth_chainId") return "0x2105";
          if (method === "net_version") return "8453";
          if (method === "wallet_switchEthereumChain") return null;
          throw Object.assign(new Error("Unsupported"), { code: 4200 });
        },
        on: () => {},
        removeListener: () => {},
      };
      const info = { uuid: "0d0c5000-0000-4000-8000-000000000000", name: "Docs Wallet", rdns: "docs.wallet", icon: "data:," };
      const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
      window.addEventListener("eip6963:requestProvider", announce);
      announce();
    }, DOCS_WALLET);
    await p.goto(url, { waitUntil: "load" });
    await p.waitForSelector("header", { timeout: 60_000 });
    await p.waitForTimeout(1500);
    const skipIntro = p.getByRole("button", { name: "Skip", exact: true });
    if (await skipIntro.count()) await skipIntro.first().click();
    await p.addStyleTag({ content: "nextjs-portal{display:none!important}" });
    await p.getByRole("button", { name: "Your profile and linked accounts" }).first().click();
    const sheet = p.getByRole("dialog").filter({ hasText: "Linked accounts" }).first();
    await sheet.getByText("Check again").waitFor({ timeout: 20_000 }); // the Coinbase check has answered
    await sheet.getByText("Your X account will show publicly", { exact: false }).waitFor({ timeout: 20_000 });
    await p.waitForTimeout(600);
    const box = await sheet.locator(".sheet-panel").boundingBox(); // the dialog itself covers the screen
    if (process.env.DEBUG_SHOTS) console.log("profile sheet box", box);
    const pad = 16;
    await p.screenshot({
      path: join(out, "screen-profile.jpg"),
      type: "jpeg",
      quality: 82,
      clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: Math.min(box.height + pad * 2, 1080 - box.y + pad) },
    });
    console.log("wrote docs-site/images/screen-profile.jpg");
  }
}

await browser.close();
if (errors.length) {
  console.error("page errors:", errors);
  process.exit(1);
}
