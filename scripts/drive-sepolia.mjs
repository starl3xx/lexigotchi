/**
 * Drive /play in a headless browser against the Base Sepolia rehearsal deployment.
 *
 *   npm run dev            # needs NEXT_PUBLIC_CHAIN_ID=84532 in .env.local
 *   node scripts/drive-sepolia.mjs
 *
 * Why this exists: everything below the UI can be verified with direct chain calls, but the wiring
 * BETWEEN the provider and the screens cannot. Running this is what caught ChainGate being mounted
 * in zero screens while its own tests passed.
 *
 * The wallet is a mock EIP-1193 provider bridged to Node, where the throwaway Sepolia deployer key
 * signs for real. TESTNET ONLY — it reads contracts/sepolia-deployer.secret.json and would be
 * reckless anywhere else.
 *
 * It deliberately answers wallet_sendCalls with "unsupported" so sendCallsAttributed takes its
 * eth_sendTransaction fallback — the path that appends the ERC-8021 builder suffix to calldata.
 *
 * NOT covered: anything requiring Quick Auth (the free pack, the daily). Those need a real Farcaster
 * client context that a headless browser cannot produce.
 */
import { chromium } from "playwright";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
const RPC = "https://sepolia.base.org";
const account = privateKeyToAccount(JSON.parse(readFileSync("contracts/sepolia-deployer.secret.json","utf8"))[0].private_key);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
const browser = await chromium.launch({ args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 430, height: 880 } })).newPage();
const errors = []; page.on("pageerror", e => errors.push(e.message.slice(0,120)));
await page.exposeFunction("__walletRpc", async (method, params = []) => {
  if (method === "eth_sendTransaction") { const t = params[0]; return wallet.sendTransaction({ to: t.to, data: t.data, value: t.value ? BigInt(t.value) : undefined }); }
  const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc:"2.0", id:1, method, params }) }).then(r => r.json());
  if (r.error) throw new Error(r.error.message); return r.result;
});
await page.addInitScript((addr) => {
  const provider = { isMetaMask: true, request: async ({ method, params }) => {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [addr];
      if (method === "eth_chainId") return "0x14a34";
      if (method === "net_version") return "84532";
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "wallet_sendCalls" || method === "wallet_getCapabilities") throw Object.assign(new Error("Unsupported"), { code: 4200 });
      return window.__walletRpc(method, params ?? []); },
    on: () => {}, removeListener: () => {} };
  window.ethereum = provider;
  const info = { uuid: "1", name: "Test Wallet", rdns: "test.wallet", icon: "data:," };
  const ann = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", ann); ann();
}, account.address);

await page.goto("http://localhost:3000/play", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(9000);
const skip = page.getByText("Skip", { exact: false }).first();
if (await skip.count()) await skip.click().catch(()=>{});
await page.waitForTimeout(2000);
const c = page.getByRole("button", { name: /connect wallet/i }).first();
if (await c.count()) await c.click();
await page.waitForTimeout(10000);

// Balance chip lives in the header
const header = await page.evaluate(() => document.querySelector("header")?.innerText ?? "");
console.log("HEADER:", JSON.stringify(header));
console.log("BALANCE_CHIP:", await page.evaluate(() => document.querySelector('[aria-label*="balance"]')?.innerText ?? "not found"));

await page.locator("nav button, footer button").filter({ hasText: /^Bag$/ }).first().click().catch(async () => { await page.getByText("My bag", { exact: false }).first().click().catch(()=>{}); });
await page.waitForTimeout(8000);
await page.screenshot({ path: "/tmp/lexi-shots/12-bag.png" });
const bag = await page.evaluate(() => document.body.innerText);
console.log("=== BAG SCREEN ===");
console.log(bag.slice(0, 900));
console.log("=== TELLS ===");
console.log("  CRANE:", /crane/i.test(bag), "| letters d/o/r/s/t/u visible:", /\b[dorstu]\b/i.test(bag));
console.log("  errors:", errors.length);
await browser.close();
