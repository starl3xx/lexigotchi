/**
 * Sharing "Your earnings" (lib/earningsShare.ts, lib/earningsShareToken.ts, lib/rewards/share.ts).
 *
 * The guard under test: the numbers on the game's card are the SERVER's. A word's card can be drawn
 * from its link because the dictionary is the guard (tests/showcase.test.ts); an amount has no such
 * guard, so the earnings route signs a snapshot of what it computed, for one player's wallets, and
 * the card draws only from a token whose signature holds. Then: what the card and the post say.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { summarizeEarnings, type LeafStatus } from "@/lib/rewards/earnings";
import {
  EARNINGS_CARD_LOOK,
  decodeSnapshot,
  earningsCardV,
  earningsCardPath,
  earningsCardText,
  earningsPostText,
  earningsShareUrl,
  encodeSnapshot,
  heroEarned,
  parseTz,
  payoutDateLabel,
  unitLabel,
  type EarningsSnapshot,
} from "@/lib/earningsShare";
import { CARD_LOOK, xIntentUrl } from "@/lib/showcase";
import { SITE_URL } from "@/lib/site";

// A token names its network, read once at import: fixed before anything loads, so a shell with the
// testnet's id set can't fail these for no reason.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CHAIN_ID = "8453";
});

const SECRET = "a-test-secret-for-the-earnings-share-cards";
const CHAIN = 8453;
/** The payout of 00:05 UTC on Nov 26, 2026. */
const DAY = Math.floor(Date.UTC(2026, 10, 26) / 86_400_000);
const snap = (over: Partial<EarningsSnapshot> = {}): EarningsSnapshot => ({
  chainId: CHAIN, latestDay: DAY, total: 2_400_000, latest: 180_500, words: [["CRANE", 96_300], ["TEASE", 84_200]], ...over,
});

let token: typeof import("@/lib/earningsShareToken");
beforeAll(async () => {
  token = await import("@/lib/earningsShareToken");
});
beforeEach(() => {
  process.env.EARNINGS_SHARE_SECRET = SECRET;
  delete process.env.PROFILE_SESSION_SECRET;
});

describe("the signed token", () => {
  it("carries the snapshot there and back", () => {
    const t = token.signEarningsShare(snap())!;
    expect(t).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{22}$/);
    expect(token.readEarningsShare(t)).toEqual(snap());
    // short enough for a link, and nothing in it names a wallet
    expect(t.length).toBeLessThan(250);
    expect(atob(t.split(".")[0].replace(/-/g, "+").replace(/_/g, "/"))).not.toMatch(/0x/i);
  });

  it("refuses an amount the server didn’t sign", () => {
    const t = token.signEarningsShare(snap())!;
    const mac = t.split(".")[1];
    const forged = `${encodeSnapshot(snap({ total: 999_000_000_000 }))}.${mac}`;
    expect(token.readEarningsShare(forged)).toBeNull();
    // one changed character anywhere in the payload
    expect(token.readEarningsShare(`X${t.slice(1)}`)).toBeNull();
  });

  it("refuses anything that isn’t a token", () => {
    const t = token.signEarningsShare(snap())!;
    for (const bad of ["", "abc", "abc.def", `${t.split(".")[0]}.`, `${t.split(".")[0]}.AAAA`, t.replace(".", ""), `${t}A`, "x".repeat(601)]) {
      expect(token.readEarningsShare(bad)).toBeNull();
    }
  });

  it("refuses another network’s token: test $WORD must never draw as the real one", () => {
    const testnet = token.signEarningsShare(snap({ chainId: 84532 }))!;
    expect(token.readEarningsShare(testnet)).toBeNull();
    expect(token.readEarningsShare(testnet, 84532)).toEqual(snap({ chainId: 84532 }));
  });

  it("signs nothing without a key, and a short one is no key", () => {
    delete process.env.EARNINGS_SHARE_SECRET;
    expect(token.earningsShareOn()).toBe(false);
    expect(token.signEarningsShare(snap())).toBeNull();
    process.env.EARNINGS_SHARE_SECRET = "too-short";
    expect(token.earningsShareOn()).toBe(false);
    process.env.PROFILE_SESSION_SECRET = "also-short";
    expect(token.signEarningsShare(snap())).toBeNull();
  });

  it("works where profiles are configured, under a key of its own", () => {
    delete process.env.EARNINGS_SHARE_SECRET;
    process.env.PROFILE_SESSION_SECRET = "the-profile-session-secret-of-32-chars-or-more";
    const t = token.signEarningsShare(snap())!;
    expect(token.readEarningsShare(t)).toEqual(snap());
    // another root is another key
    process.env.PROFILE_SESSION_SECRET = "another-profile-session-secret-of-32-characters";
    expect(token.readEarningsShare(t)).toBeNull();
  });

  it("keeps a posted link alive when the share later gets its own secret", () => {
    delete process.env.EARNINGS_SHARE_SECRET;
    process.env.PROFILE_SESSION_SECRET = "the-profile-session-secret-of-32-chars-or-more";
    const old = token.signEarningsShare(snap())!;
    process.env.EARNINGS_SHARE_SECRET = SECRET;
    // the dedicated secret signs from now on, and the link posted before still draws
    const now = token.signEarningsShare(snap())!;
    expect(now).not.toBe(old);
    expect(token.readEarningsShare(old)).toEqual(snap());
    expect(token.readEarningsShare(now)).toEqual(snap());
    // a forged amount holds under neither key
    expect(token.readEarningsShare(`${encodeSnapshot(snap({ total: 999_000_000_000 }))}.${old.split(".")[1]}`)).toBeNull();
  });
});

describe("decodeSnapshot", () => {
  const enc = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  it("takes exactly a snapshot and nothing else", () => {
    expect(decodeSnapshot(enc([1, CHAIN, DAY, 5, 1, [["CRANE", 5]]]))).toEqual({ chainId: CHAIN, latestDay: DAY, total: 5, latest: 1, words: [["CRANE", 5]] });
    expect(decodeSnapshot(enc([1, CHAIN, 0, 5, 0, []]))?.latestDay).toBeNull();
    for (const bad of [
      [2, CHAIN, DAY, 5, 1, []], // another version
      [1, CHAIN, DAY, 5, 1, [], "more"],
      [1, CHAIN, DAY, -5, 1, []],
      [1, CHAIN, DAY, 5.5, 1, []],
      [1, CHAIN, DAY, "5", 1, []],
      [1, CHAIN, DAY, 5, 1, [["crane", 5]]], // not UPPERCASE
      [1, CHAIN, DAY, 5, 1, [["<b>HI", 5]]],
      [1, CHAIN, DAY, 5, 1, [["CRANE", 5, 6]]],
      [1, CHAIN, DAY, 5, 1, Array(6).fill(["CRANE", 5])], // more words than a snapshot holds
      { total: 5 },
    ]) {
      expect(decodeSnapshot(enc(bad))).toBeNull();
    }
    expect(decodeSnapshot("not base64 json")).toBeNull();
  });
});

describe("what the route signs (lib/rewards/share.ts)", () => {
  const WEI = 10n ** 18n;
  const leaf = (word: string, amount: bigint, epochId = String(DAY), stream: "yield" | "bounty" = "yield"): LeafStatus => ({
    stream, epochId, tokenId: tokenIdOf(word).toString(), account: "0x1", amount, paid: true,
  });

  it("is the route’s own sums in whole $WORD, rounded down, with the top words by name", async () => {
    const { snapshotOf } = await import("@/lib/rewards/share");
    const summary = summarizeEarnings(
      [leaf("CRANE", 96_300n * WEI + WEI - 1n), leaf("TEASE", 84_200n * WEI), leaf("TEASE", 100n * WEI, String(DAY - 1)), leaf("CRANE", 75_000n * WEI, "2960", "bounty")], // a bounty week that paid on an earlier day
      DAY,
    );
    const s = snapshotOf(summary, CHAIN);
    expect(s).toEqual({ chainId: CHAIN, latestDay: DAY, total: 255_600, latest: 180_500, words: [["CRANE", 96_300], ["TEASE", 84_300]] });
  });

  it("names five words at most, never a token that is no dictionary word or earned under one $WORD", async () => {
    const { snapshotOf } = await import("@/lib/rewards/share");
    const words = ["CRANE", "TEASE", "VIVID", "MOTEL", "JAZZY", "QUILT", "PIXEL"];
    const leaves = words.map((w, i) => leaf(w, BigInt(1000 - i) * WEI));
    leaves.push({ ...leaf("CRANE", 5_000n * WEI), tokenId: "12345" }, leaf("OCEAN", WEI / 2n));
    const s = snapshotOf(summarizeEarnings(leaves, DAY), CHAIN);
    expect(s.words.map(([w]) => w)).toEqual(["CRANE", "TEASE", "VIVID", "MOTEL", "JAZZY"]);
  });

  it("covers ONE account: the first wallet’s", async () => {
    const { accountWalletsOf } = await import("@/lib/rewards/share");
    const A = "0x00000000000000000000000000000000000000aa";
    const B = "0x00000000000000000000000000000000000000bb";
    const C = "0x00000000000000000000000000000000000000cc";
    expect(accountWalletsOf([A], new Map([[A, A]]))).toEqual([A]);
    expect(accountWalletsOf([A, B], new Map([[A, A], [B, A]]))).toEqual([A, B]); // B is linked into A's account
    expect(accountWalletsOf([A.toUpperCase().replace("0X", "0x"), B], new Map([[A, A], [B, A]]))).toEqual([A, B]);
    // a stranger's wallet is left out: its earnings are nobody's to add to A's
    expect(accountWalletsOf([A, C], new Map([[A, A], [C, C]]))).toEqual([A]);
    expect(accountWalletsOf([A, B, C], new Map([[A, A], [B, A], [C, C]]))).toEqual([A, B]);
    // the first wallet decides whose account it is
    expect(accountWalletsOf([C, A, B], new Map([[A, A], [B, A], [C, C]]))).toEqual([C]);
    // the links couldn't be read (every wallet reads as its own account): the first wallet alone
    expect(accountWalletsOf([A, B], new Map())).toEqual([A]);
    expect(accountWalletsOf([], new Map())).toEqual([]);
  });
});

describe("the earnings route’s `share`", () => {
  const A = "0x00000000000000000000000000000000000000aa";
  const B = "0x00000000000000000000000000000000000000bb";
  const shares = vi.hoisted(() => ({ rows: [] as unknown[], accounts: new Map<string, string>() }));
  vi.mock("@/lib/ratelimit", () => ({ allow: async () => true }));
  vi.mock("@/lib/onchain/addresses", () => ({ isSuiteDeployed: () => true }));
  vi.mock("@/lib/db/client", () => ({ isCampaignConfigured: () => true }));
  // as the real loader does: only the shares paying the wallets asked for
  vi.mock("@/lib/rewards/load", () => ({
    loadShares: async (ws: string[]) => (shares.rows as { account: string }[]).filter((r) => ws.includes(r.account)),
    latestYieldDay: async () => DAY,
  }));
  vi.mock("@/lib/db/walletLinks", () => ({ accountsOf: async (ws: string[]) => new Map(ws.map((w) => [w, shares.accounts.get(w) ?? w])) }));
  const ask = async (wallets: string) => {
    const { GET } = await import("@/app/api/rewards/earnings/route");
    return (await GET(new Request(`https://lexigotchi.test/api/rewards/earnings?wallets=${wallets}`))).json();
  };
  const paid = (word: string, account: string, amount: bigint) => ({
    stream: "yield", epochId: String(DAY), tokenId: tokenIdOf(word).toString(), account, amount: String(amount), paid: true, dead: false,
  });
  beforeEach(() => {
    shares.rows = [paid("CRANE", A, 96_300n * 10n ** 18n), paid("TEASE", B, 84_200n * 10n ** 18n)];
    shares.accounts = new Map();
  });

  it("signs the snapshot of one wallet’s earnings, and the token reads back as those sums", async () => {
    const res = await ask(A);
    expect(res.ok).toBe(true);
    expect(token.readEarningsShare(res.share)).toMatchObject({ total: 96_300, words: [["CRANE", 96_300]] });
  });

  it("signs the whole list for linked wallets, and only the first wallet’s account for a list that spans accounts", async () => {
    // B is a stranger to A: the earnings answer adds both up (as it always did), the snapshot doesn't
    const mixed = await ask(`${A},${B}`);
    expect(mixed.earnings.total).toBe(String(180_500n * 10n ** 18n));
    expect(token.readEarningsShare(mixed.share)).toMatchObject({ total: 96_300, words: [["CRANE", 96_300]] });
    // ... and from B's side, B's own
    expect(token.readEarningsShare((await ask(`${B},${A}`)).share)).toMatchObject({ total: 84_200, words: [["TEASE", 84_200]] });
    // linked into one account: everything
    shares.accounts = new Map([[B, A]]);
    expect(token.readEarningsShare((await ask(`${A},${B}`)).share)).toMatchObject({ total: 180_500 });
  });

  it("gives no token when the first wallet’s account earned nothing, whatever the others did", async () => {
    shares.rows = [paid("TEASE", B, 84_200n * 10n ** 18n)];
    expect((await ask(`${A},${B}`)).share).toBeNull();
  });

  it("gives no token for nothing earned, or without a key, and still answers the earnings", async () => {
    shares.rows = [];
    expect(await ask(A)).toMatchObject({ ok: true, share: null });
    shares.rows = [paid("CRANE", A, 5n * 10n ** 18n)];
    delete process.env.EARNINGS_SHARE_SECRET;
    const res = await ask(A);
    expect(res).toMatchObject({ ok: true, share: null });
    expect(res.earnings.total).toBe(String(5n * 10n ** 18n));
  });
});

describe("the card refuses a token it can’t verify", () => {
  it("answers 404 before drawing anything", async () => {
    const { GET } = await import("@/app/e/[token]/card/route");
    for (const bad of ["abc.def", `${encodeSnapshot(snap({ total: 999_000_000_000 }))}.AAAAAAAAAAAAAAAAAAAAAA`]) {
      const res = await GET(new Request(`https://lexigotchi.test/e/${bad}/card`), { params: Promise.resolve({ token: bad }) });
      expect(res.status).toBe(404);
    }
  });
});

describe("what the card says", () => {
  it("leads with the words, in the game’s $WORD, and never in dollars", () => {
    const t = earningsCardText(snap(), { testnet: false, hero: "CRANE" });
    expect(t).toEqual({ kicker: "My words have earned", amount: "2.40M", unit: "$WORD", latest: "+180.5K on Nov 26", plate: "CRANE has earned 96.3K" });
    expect(Object.values(t).join(" ").replace(/\$WORD/g, "")).not.toMatch(/\$|USD/);
  });

  it("says “test $WORD” on a test network", () => {
    expect(unitLabel(true)).toBe("test $WORD");
    expect(earningsCardText(snap(), { testnet: true }).unit).toBe("test $WORD");
  });

  it("prints the payout’s date on the sharer’s calendar, never “today”", () => {
    // 00:05 UTC on Nov 26 is the evening of Nov 25 in the Americas, and Nov 26 east of Greenwich
    expect(payoutDateLabel(DAY, -360)).toBe("Nov 25");
    expect(payoutDateLabel(DAY, -5)).toBe("Nov 26");
    expect(payoutDateLabel(DAY, -6)).toBe("Nov 25");
    expect(payoutDateLabel(DAY, 0)).toBe("Nov 26");
    expect(payoutDateLabel(DAY, 540)).toBe("Nov 26");
    expect(earningsCardText(snap(), { testnet: false, tz: -360 }).latest).toBe("+180.5K on Nov 25");
  });

  it("takes only a real clock offset from the link", () => {
    expect(parseTz("-360")).toBe(-360);
    expect(parseTz("840")).toBe(840);
    for (const bad of [null, undefined, "", "841", "-721", "1e3", "12.5", "abc", "-0x10", "99999"]) expect(parseTz(bad)).toBe(0);
  });

  it("never says “+0”: a payout that brought nothing has no line", () => {
    expect(earningsCardText(snap({ latest: 0 }), { testnet: false }).latest).toBeNull();
    expect(earningsCardText(snap({ latestDay: null }), { testnet: false }).latest).toBeNull();
  });

  it("puts an amount beside the pictured word only when the token names it", () => {
    expect(heroEarned(snap(), "crane")).toBe(96_300);
    expect(heroEarned(snap(), "GHOST")).toBeNull();
    expect(earningsCardText(snap(), { testnet: false, hero: "GHOST" }).plate).toBeNull();
    expect(earningsCardText(snap(), { testnet: false }).plate).toBeNull();
    // the only word, and all of the total: the sign already says it
    expect(earningsCardText(snap({ total: 96_300, words: [["CRANE", 96_300]] }), { testnet: false, hero: "CRANE" }).plate).toBeNull();
  });

  it("holds the largest amounts", () => {
    expect(earningsCardText(snap({ total: 999_990_000_000 }), { testnet: true }).amount).toBe("999.99B");
  });
});

describe("what the post says", () => {
  it("leads with the word, and names the game’s account on X only", () => {
    const x = earningsPostText(snap(), { testnet: true, hero: "CRANE", on: "x" });
    expect(x).toBe("CRANE and my other words have earned 2.40M test $WORD in @lexigotchi ✨");
    const cast = earningsPostText(snap(), { testnet: true, hero: "CRANE", on: "fc" });
    expect(cast).toBe("CRANE and my other words have earned 2.40M test $WORD in Lexigotchi ✨");
    expect(cast).not.toContain("@");
    // X's composer link keeps the tag once
    expect(new URL(xIntentUrl(x, "https://x.test")).searchParams.get("text")).toBe(x);
  });

  it("speaks of one word when one word earned it all, and of “my words” when the pictured word isn’t named", () => {
    const one = snap({ total: 96_300, latest: 96_300, words: [["CRANE", 96_300]] });
    expect(earningsPostText(one, { testnet: false, hero: "CRANE", on: "x" })).toBe("CRANE has earned 96.3K $WORD in @lexigotchi ✨");
    expect(earningsPostText(snap(), { testnet: false, hero: "GHOST", on: "x" })).toBe("My words have earned 2.40M $WORD in @lexigotchi ✨");
    // one named word, but the total holds more (a bounty, a word since sold): not "has earned" it all
    expect(earningsPostText(snap({ words: [["CRANE", 96_300]] }), { testnet: false, hero: "CRANE", on: "x" })).toBe("My words have earned 2.40M $WORD in @lexigotchi ✨");
  });
});

describe("the link", () => {
  const T = "payload.mac";
  it("is /e/<token>, with the pictured word, its scene, and the clock offset as cosmetic parts", () => {
    expect(earningsShareUrl(T)).toBe(`${SITE_URL}/e/${T}`);
    expect(earningsShareUrl(T, { hero: "CRANE", scene: "spring", tz: -360 })).toBe(`${SITE_URL}/e/${T}?w=CRANE&scene=spring&tz=-360`);
    // UTC takes no parameter. The scene is ALWAYS named, the stock card too: a link with no scene
    // means the Stage (lib/scenes LINK_DEFAULT_SCENE), which is not where a word starts.
    expect(earningsShareUrl(T, { hero: "CRAne", scene: "stock", tz: 0 })).toBe(`${SITE_URL}/e/${T}?w=CRAne&scene=stock`);
    expect(earningsShareUrl(T, { hero: "CRAne", scene: "stage" })).toBe(`${SITE_URL}/e/${T}?w=CRAne&scene=stage`);
  });

  it("names the card’s shape, and BOTH looks it draws: its own and the word card’s", () => {
    expect(earningsCardV()).toBe(`${EARNINGS_CARD_LOOK}.${CARD_LOOK}`);
    expect(earningsCardPath(T)).toBe(`/e/${T}/card?v=${earningsCardV()}`);
    expect(earningsCardPath(T, "fc", { hero: "CRANE" })).toBe(`/e/${T}/card?w=CRANE&ratio=3x2&v=${earningsCardV()}`);
    // the picture that travels alone: 16:9, with the wordmark
    expect(earningsCardPath(T, "wide", { hero: "CRANE", tz: -360 }, true)).toBe(`/e/${T}/card?w=CRANE&tz=-360&ratio=16x9&saved=1&v=${earningsCardV()}`);
  });
});
