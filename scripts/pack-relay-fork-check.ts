/**
 * A relayed pack, end to end, against the DEPLOYED Letters on a local fork (decisions.md #49).
 *
 * The route tests mock the chain, so they can't say whether the contract that is really out there
 * accepts a reveal sent by somebody other than the buyer. This does: it buys a pack on a fork of
 * Base Sepolia, asks the real route handler to open it, and checks what the chain then holds.
 *
 *   anvil --fork-url https://sepolia.base.org --port 8611
 *   NEXT_PUBLIC_CHAIN_ID=84532 NEXT_PUBLIC_RPC_URL=http://127.0.0.1:8611 npx tsx scripts/pack-relay-fork-check.ts
 *
 * Nothing reaches the real chain, and no real key is used: the buyer, the signer, and the relayer
 * are Anvil's public test accounts, and the fork's Letters is told to trust that signer (as its
 * owner, impersonated). It refuses an RPC that isn't on this machine, and refuses to run with a
 * DATABASE_URL at all: the stored draw (lib/onchain/stickyDraw) writes rows.
 */
import { createPublicClient, createTestClient, createWalletClient, decodeEventLog, erc20Abi, http, parseAbi, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

const local = (url: string | undefined) => !!url && /^[a-z]+:\/\/(localhost|127\.0\.0\.1)([:/]|$)/.test(url);
if (!local(process.env.NEXT_PUBLIC_RPC_URL)) throw new Error("NEXT_PUBLIC_RPC_URL must be a fork on this machine: this check buys packs and changes the contract's signer.");
if (process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED) throw new Error("Run this with no DATABASE_URL: the stored draw writes rows.");
if (process.env.NEXT_PUBLIC_CHAIN_ID !== "84532") throw new Error("Set NEXT_PUBLIC_CHAIN_ID=84532 (the fork is Base Sepolia).");

// Anvil's well-known test keys: public, worthless, and only ever used against a local fork.
const buyer = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
const SIGNER_KEY = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";
const RELAYER_KEY = "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6";
const signer = privateKeyToAccount(SIGNER_KEY);
const relayer = privateKeyToAccount(RELAYER_KEY);
process.env.SIGNER_PRIVATE_KEY = SIGNER_KEY;
process.env.SIGNER_DRAW_SECRET = "fork-check-not-a-real-secret";
process.env.RELAYER_PRIVATE_KEY = RELAYER_KEY;

const FORK = process.env.NEXT_PUBLIC_RPC_URL!;
const transport = http(FORK);
const pub = createPublicClient({ chain: baseSepolia, transport });
const anvil = createTestClient({ chain: baseSepolia, transport, mode: "anvil" });
const wallet = createWalletClient({ account: buyer, chain: baseSepolia, transport });

let failed = 0;
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || detail === undefined ? "" : `  ${JSON.stringify(detail, (_k, v) => (typeof v === "bigint" ? String(v) : v))}`}`);
};

async function main() {
  // imported after the env above is set: the route's modules read it
  const A = await import("../src/lib/onchain/addresses");
  const { lettersAbi } = await import("../src/lib/onchain/abis");
  const { revealCalls } = await import("../src/lib/onchain/actions");
  const { BUILDER_DATA_SUFFIX } = await import("../src/lib/onchain/builderCode");
  const route = await import("../src/app/api/mint/reveal/route");

  const letters = A.addressOf("letters");
  const word = A.wordTokenAddress();
  const post = async (body: unknown) => {
    const res = await route.POST(new Request("http://local/api/mint/reveal", { method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" }, body: JSON.stringify(body) }));
    return { status: res.status, ...((await res.json()) as { ok: boolean; error?: string; reveal?: Record<string, unknown> }) };
  };
  const send = async (to: Hex, data: Hex) => {
    const hash = await wallet.sendTransaction({ to, data });
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`reverted: ${hash}`);
    return receipt;
  };
  const balances = async () => {
    const got = (await pub.multicall({
      allowFailure: false,
      contracts: Array.from({ length: 26 }, (_, i) => ({ address: letters, abi: lettersAbi, functionName: "balanceOf" as const, args: [buyer.address, BigInt(i)] as const })),
    })) as bigint[];
    return got.map(Number);
  };
  const revealedFlag = async (id: bigint) => ((await pub.readContract({ address: letters, abi: lettersAbi, functionName: "commits", args: [id] })) as unknown as readonly [string, number, boolean])[2];

  // 1. the fork's Letters trusts the test signer (its real one's key is not on this machine)
  const owner = (await pub.readContract({ address: letters, abi: lettersAbi, functionName: "owner" })) as Hex;
  await anvil.setBalance({ address: owner, value: 10n ** 18n });
  await anvil.impersonateAccount({ address: owner });
  const asOwner = createWalletClient({ account: owner, chain: baseSepolia, transport });
  await pub.waitForTransactionReceipt({ hash: await asOwner.writeContract({ address: letters, abi: lettersAbi, functionName: "setSigner", args: [signer.address] }) });
  await anvil.stopImpersonatingAccount({ address: owner });
  await anvil.setBalance({ address: relayer.address, value: 10n ** 18n });

  // 2. the buyer has test $WORD for a few packs, and Letters may take it
  const price = (await pub.readContract({ address: letters, abi: lettersAbi, functionName: "packPrice" })) as bigint;
  const mint = parseAbi(["function mint(address,uint256)"]);
  const { encodeFunctionData } = await import("viem");
  await send(word, encodeFunctionData({ abi: mint, functionName: "mint", args: [buyer.address, price * 4n] }));
  await send(word, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [letters, price * 4n] }));

  /** Buy one pack; its commit id is in the receipt's own `Committed` event. */
  const buy = async (): Promise<bigint> => {
    const receipt = await send(letters, encodeFunctionData({ abi: lettersAbi, functionName: "commitPack" }));
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== letters.toLowerCase()) continue;
      try {
        const ev = decodeEventLog({ abi: lettersAbi, data: log.data, topics: log.topics });
        if (ev.eventName === "Committed") return (ev.args as unknown as { commitId: bigint }).commitId;
      } catch {
        /* another event */
      }
    }
    throw new Error("no Committed event");
  };

  // 3. a pack, opened by the server
  const first = await buy();
  const had = await balances();
  const opened = await post({ commitId: String(first), relay: true });
  const minted = (opened.reveal?.letterIndexes ?? []) as number[];
  check("the route answers ok, relayed “mined”, with five letters and no signature", opened.ok && opened.reveal?.relayed === "mined" && minted.length === 5 && opened.reveal?.signature === undefined, opened);
  check("the chain says the commit is revealed", await revealedFlag(first));
  const now = await balances();
  const expected = had.slice();
  for (const i of minted) expected[i]++;
  check("the buyer holds exactly the letters the answer named, and nothing else changed", JSON.stringify(now) === JSON.stringify(expected), { minted, gained: now.map((v, i) => v - had[i]) });
  const tx = await pub.getTransaction({ hash: opened.reveal?.txHash as Hex });
  check("the reveal was sent by the relayer, not the buyer", tx.from.toLowerCase() === relayer.address.toLowerCase(), { from: tx.from });
  check("and it carries the builder code", tx.input.toLowerCase().endsWith(BUILDER_DATA_SUFFIX.slice(2).toLowerCase()));

  // 4. asked again: opened already, and never a second send
  const nonce = await pub.getTransactionCount({ address: relayer.address });
  const again = await post({ commitId: String(first), relay: true });
  check("a second ask answers “already”", again.ok && again.reveal?.relayed === "already" && again.reveal?.signature === undefined, again);
  const readBack = again.reveal?.letterIndexes as number[] | undefined;
  if (readBack) check("with the same letters, read back from the reveal's own event", JSON.stringify(readBack) === JSON.stringify(minted), readBack);
  else console.log("NOTE  “already” named no letters: the public RPC behind this fork refuses the long log range the lookup needs. The production RPC allows it (the daily letter's lookup uses the same range).");
  check("and the relayer sent nothing more", (await pub.getTransactionCount({ address: relayer.address })) === nonce);
  const old = await post({ commitId: String(first) });
  check("without relay an opened commit is still 409", old.status === 409 && old.error === "already_revealed", old);

  // 5. a client from before the relay: the signature, sent by the buyer's own wallet
  const second = await buy();
  const plain = await post({ commitId: String(second) });
  check("without relay the answer is the draw and its signature", plain.ok && plain.reveal?.relayed === undefined && typeof plain.reveal?.signature === "string" && (plain.reveal?.letterIndexes as number[]).length === 5, plain);
  check("and the relayer sent nothing", (await pub.getTransactionCount({ address: relayer.address })) === nonce);
  const before2 = await balances();
  for (const c of revealCalls(second, plain.reveal?.letterIndexes as number[], plain.reveal?.signature as Hex)) await send(c.to as Hex, c.data as Hex);
  const after2 = await balances();
  const expected2 = before2.slice();
  for (const i of plain.reveal?.letterIndexes as number[]) expected2[i]++;
  check("the buyer's own reveal with that signature still mints those letters", (await revealedFlag(second)) && JSON.stringify(after2) === JSON.stringify(expected2));

  // 6. a relayer with no gas: nothing is broadcast, so the wallet path is handed back
  const third = await buy();
  process.env.RELAYER_PRIVATE_KEY = generatePrivateKey();
  const broke = await post({ commitId: String(third), relay: true });
  check("an unfunded relayer answers with the signature (no `relayed`), and the pack stays open", broke.ok && broke.reveal?.relayed === undefined && typeof broke.reveal?.signature === "string" && !(await revealedFlag(third)), broke);
  process.env.RELAYER_PRIVATE_KEY = RELAYER_KEY;
  // The game's next step with that answer is the wallet (lib/onchain/packReveal: no `relayed` field).
  const before3 = await balances();
  for (const c of revealCalls(third, broke.reveal?.letterIndexes as number[], broke.reveal?.signature as Hex)) await send(c.to as Hex, c.data as Hex);
  const expected3 = before3.slice();
  for (const i of broke.reveal?.letterIndexes as number[]) expected3[i]++;
  check("and the buyer's wallet opens it with that signature: the same letters it named", (await revealedFlag(third)) && JSON.stringify(await balances()) === JSON.stringify(expected3));
  const late = await post({ commitId: String(third), relay: true });
  check("asked once more, the route says “already” and sends nothing", late.reveal?.relayed === "already" && (await pub.getTransactionCount({ address: relayer.address })) === nonce, late);

  console.log(failed ? `\n${failed} FAILED` : "\nall passed");
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
