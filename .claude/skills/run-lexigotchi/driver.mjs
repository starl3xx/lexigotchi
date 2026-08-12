/**
 * Drive the Lexigotchi mini app (/play) in headless Chromium.
 *
 *   node .claude/skills/run-lexigotchi/driver.mjs [options]
 *
 *   --wallet          inject a mock EIP-1193 wallet and click Connect
 *   --goto <screen>   bottom-nav target after load: Today | Bag | Mint | Win | More
 *   --shot <name>     screenshot basename (default: play) → /tmp/lexi-shots/<name>.png
 *   --url <url>       default http://localhost:3000/play
 *
 * WHY THIS EXISTS
 * Everything below the UI can be checked with direct chain calls from Node. The wiring BETWEEN the
 * provider and the screens cannot — that only appears in a browser. Running this is what caught
 * ChainGate being mounted in zero screens while its own nine tests passed.
 *
 * THE WALLET
 * --wallet installs a mock EIP-1193 provider whose requests are bridged to Node, where viem signs
 * with the throwaway Sepolia deployer key. TESTNET ONLY: it reads
 * contracts/sepolia-deployer.secret.json and would be reckless pointed anywhere else.
 *
 * It deliberately answers wallet_sendCalls with "unsupported" (code 4200) so sendCallsAttributed
 * takes its eth_sendTransaction fallback — the path that appends the ERC-8021 builder suffix, which
 * is the one worth exercising.
 *
 * NOT DRIVABLE HERE: anything behind Quick Auth (the free pack, the daily). Those need a real
 * Farcaster host to mint a JWT; a plain browser has no such context and the routes return 401.
 */
import { chromium } from "playwright";
import { existsSync, readFileSync, mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const val = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);

const URL = val("--url", "http://localhost:3000/play");
const SHOT = val("--shot", "play");
const GOTO = val("--goto", null);
const WANT_WALLET = flag("--wallet");
const SHOT_DIR = "/tmp/lexi-shots";
const RPC = "https://sepolia.base.org";
const KEYFILE = "contracts/sepolia-deployer.secret.json";

mkdirSync(SHOT_DIR, { recursive: true });

let account, wallet;
if (WANT_WALLET) {
  if (!existsSync(KEYFILE)) {
    console.error(`--wallet needs ${KEYFILE} (throwaway Sepolia key). Run without --wallet for read-only.`);
    process.exit(1);
  }
  const { createWalletClient, http } = await import("viem");
  const { privateKeyToAccount } = await import("viem/accounts");
  const { baseSepolia } = await import("viem/chains");
  account = privateKeyToAccount(JSON.parse(readFileSync(KEYFILE, "utf8"))[0].private_key);
  wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
}

const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 430, height: 880 } })).newPage();

const errors = [];
page.on("pageerror", (e) => errors.push("PAGEERROR: " + e.message.slice(0, 160)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text().slice(0, 160));
});

if (WANT_WALLET) {
  await page.exposeFunction("__walletRpc", async (method, params = []) => {
    if (method === "eth_sendTransaction") {
      const t = params[0];
      return wallet.sendTransaction({
        to: t.to,
        data: t.data,
        value: t.value ? BigInt(t.value) : undefined,
      });
    }
    const r = await fetch(RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    }).then((x) => x.json());
    if (r.error) throw new Error(r.error.message);
    return r.result;
  });

  await page.addInitScript((addr) => {
    const provider = {
      isMetaMask: true,
      request: async ({ method, params }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [addr];
        if (method === "eth_chainId") return "0x14a34"; // Base Sepolia 84532
        if (method === "net_version") return "84532";
        if (method === "wallet_switchEthereumChain") return null;
        if (method === "wallet_sendCalls" || method === "wallet_getCapabilities") {
          throw Object.assign(new Error("Unsupported"), { code: 4200 });
        }
        return window.__walletRpc(method, params ?? []);
      },
      on: () => {},
      removeListener: () => {},
    };
    window.ethereum = provider;
    // wagmi's injected connector discovers wallets over EIP-6963; without this announcement it
    // finds nothing even though window.ethereum is set.
    const info = { uuid: "11111111-2222-3333-4444-555555555555", name: "Test Wallet", rdns: "test.wallet", icon: "data:," };
    const announce = () =>
      window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  }, account.address);
}

await page.goto(URL, { waitUntil: "domcontentloaded" });
// Next compiles /play on demand; the first load is ~10s. Wait for the shell, not a fixed guess.
await page.waitForSelector("header", { timeout: 60_000 });
await page.waitForTimeout(3000);

// Onboarding covers the whole app on a fresh profile — dismiss it or nothing else is reachable.
const skip = page.getByText("Skip", { exact: false }).first();
if (await skip.count()) await skip.click().catch(() => {});
await page.waitForTimeout(1500);

if (WANT_WALLET) {
  const connect = page.getByRole("button", { name: /connect wallet/i }).first();
  if (await connect.count()) {
    await connect.click();
    await page.waitForTimeout(9000); // wallet handshake + first multicall
  }
}

if (GOTO) {
  await page
    .locator("nav button, footer button")
    .filter({ hasText: new RegExp(`^${GOTO}$`) })
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(6000);
}

const shotPath = `${SHOT_DIR}/${SHOT}.png`;
await page.screenshot({ path: shotPath });

const header = await page.evaluate(() => document.querySelector("header")?.innerText ?? "");
const body = await page.evaluate(() => document.body.innerText);

console.log("URL        :", URL);
console.log("wallet     :", WANT_WALLET ? account.address : "none");
console.log("screen     :", GOTO ?? "(default)");
console.log("screenshot :", shotPath);
console.log("HEADER     :", JSON.stringify(header));
console.log("--- BODY (first 600) ---");
console.log(body.slice(0, 600));
console.log("--- CONSOLE ERRORS:", errors.length, "---");
for (const e of errors.slice(0, 8)) console.log("  " + e);
// "NaN" or a bare 0 balance means a chain read failed and the UI rendered it as poverty.
console.log("NaN in DOM :", /NaN/.test(body));

await browser.close();
process.exit(errors.length > 0 ? 1 : 0);
