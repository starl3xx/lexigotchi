/**
 * Reserved word sets on the server (lib/sets/server.ts, /api/dictionary/proof, /api/admin/sets):
 * a reserved word can't be claimed and has no proof; a released one can; a release never removes a
 * word; a draft edit never stops a claim; and nothing private leaves an ungated route.
 *
 * The database is stood in for by a small in-memory book (scripts/sets-db-check.ts proves the SQL
 * against a real Postgres). The test words are ordinary dictionary words picked for the test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { StandardMerkleTree } from "@openzeppelin/merkle-tree";
import { STANDARD_FIELDS, type WordSet } from "@/lib/sets/rules";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532"); // a network with a deployed suite
vi.stubEnv("DATABASE_URL", "postgresql://stand-in"); // "a database is configured"; lib/db/sets is mocked

const world = vi.hoisted(() => ({
  sets: [] as WordSet[],
  roots: new Map<string, { held: string[]; note: string; n: number }>(),
  migrated: true,
  fail: false,
  chainRoot: "",
  gate: false,
  gateUnreadable: false,
  gateOf: new Map<string, number>(), // word → Words.gatedUntil, in seconds
  owned: new Set<string>(),
  ownedUnreadable: false,
  ids: new Map<string, string>(), // token id → word, filled as the tests name words
  collab: true, // migration 0023 has run
  stamps: new Map<number, { mime: string; base64: string }>(),
  lists: new Map<number, string[]>(),
  made: [] as Record<string, unknown>[],
  tokenDown: false, // a token rule's contract can't be read on Base
  tokenAsked: [] as string[],
}));

// A token rule's contract is asked on Base MAINNET, whatever network the game is on.
vi.mock("@/lib/onchain/mainnet", () => ({
  getMainnetClient: () => ({
    readContract: async ({ address }: { address: string }) => {
      world.tokenAsked.push(address.toLowerCase());
      if (world.tokenDown) throw new Error("execution reverted");
      return 0n;
    },
  }),
}));

vi.mock("@/lib/db/sets", () => {
  class SetError extends Error {
    constructor(public code: string, public words: string[] = [], public problems: string[] = []) {
      super(code);
    }
  }
  return {
    SetError,
    // What a collab adds, kept in the test's world.
    setStamp: async (_c: number, id: number, stamp: { mime: string; base64: string }) => {
      const s = world.sets.find((x) => x.id === id);
      if (!s) throw new SetError("not_found");
      if (s.status !== "draft") throw new SetError("locked");
      world.stamps.set(id, stamp);
      s.stampAt = new Date(1_800_000_000_000);
    },
    clearStamp: async (_c: number, id: number) => {
      world.stamps.delete(id);
      const s = world.sets.find((x) => x.id === id);
      if (s) s.stampAt = null;
    },
    readStamp: async (_c: number, id: number) => {
      const s = world.sets.find((x) => x.id === id);
      const st = world.stamps.get(id);
      return s && st ? { status: s.status, ...st } : null;
    },
    readStamps: async () => new Map([...world.stamps].map(([id, st]) => [id, `data:${st.mime};base64,${st.base64}`])),
    replaceAllowlist: async (_c: number, id: number, wallets: string[]) => {
      const s = world.sets.find((x) => x.id === id);
      if (!s) throw new SetError("not_found");
      if (s.status === "released") throw new SetError("locked");
      world.lists.set(id, [...wallets]);
      s.allowlistCount = wallets.length;
      return wallets.length;
    },
    createSet: async (_c: number, settings: Record<string, unknown>) => {
      world.made.push(settings);
      const id = 900 + world.made.length;
      world.sets.push({ ...draftLike(id), ...(settings as object) } as unknown as WordSet);
      return id;
    },
    addWords: async (_c: number, id: number, list: string[]) => {
      const s = world.sets.find((x) => x.id === id);
      if (s) s.words.push(...list.map((word) => ({ word, headliner: false })));
      return { added: list, taken: [] };
    },
    listSets: async () => {
      // A driver's error names the statement's parameters: the words. It must never be logged whole.
      if (world.fail) throw Object.assign(new Error("Failed query … params: ZEBRA,SECRETSET"), { code: "08006" });
      return { sets: world.sets.map((s) => ({ ...s, words: [...s.words] })), migrated: world.migrated, collab: world.collab };
    },
    revealDue: async () => [],
    saveRoot: async (_c: number, root: string, held: string[], note: string) => {
      if (!world.roots.has(root)) world.roots.set(root, { held: [...held], note, n: world.roots.size });
    },
    heldOfRoot: async (_c: number, root: string) => world.roots.get(root)?.held ?? null,
    newestRoot: async () => {
      const last = [...world.roots.entries()].sort((a, b) => b[1].n - a[1].n)[0];
      return last ? { root: last[0], held: last[1].held } : null;
    },
    setReleaseRoot: async (_c: number, id: number, root: string) => {
      const s = world.sets.find((x) => x.id === id);
      if (!s || s.status !== "revealed") return false;
      s.releaseRoot = root;
      return true;
    },
    markReleased: async (_c: number, id: number, at: { releasedAt: Date; gateUntil: Date | null; releaseBlock: number | null }) => {
      const s = world.sets.find((x) => x.id === id);
      if (!s || s.status !== "revealed") return false;
      Object.assign(s, { status: "released", ...at });
      return true;
    },
  };
});

// Whether this network's Words has the gate is the registry's fact (config/deployments*.json).
vi.mock("@/lib/onchain/addresses", async (orig) => ({ ...(await orig<typeof import("@/lib/onchain/addresses")>()), wordsHaveGate: () => world.gate }));

vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({
    readContract: async ({ functionName, args }: { functionName: string; args?: readonly bigint[] }) => {
      if (functionName === "dictionaryRoot") return world.chainRoot;
      if (functionName === "claimSigner") {
        if (world.gateUnreadable) throw new Error("rpc down");
        return "0x00000000000000000000000000000000000000aa";
      }
      if (functionName === "gatedUntil") {
        if (world.gateUnreadable) throw new Error("rpc down");
        return BigInt(world.gateOf.get(world.ids.get(String(args?.[0])) ?? "") ?? 0);
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    multicall: async ({ contracts }: { contracts: { functionName: string; args: [bigint] }[] }) => {
      if (world.ownedUnreadable && contracts.some((c) => c.functionName === "exists")) throw new Error("rpc down");
      if (world.gateUnreadable && contracts.some((c) => c.functionName === "gatedUntil")) throw new Error("rpc down");
      return contracts.map((c) => (c.functionName === "gatedUntil" ? 1_900_000_000n : world.owned.has(world.ids.get(String(c.args[0])) ?? "")));
    },
    getBlockNumber: async () => 1000n,
    getLogs: async () => [],
    getBlock: async () => ({ number: 1000n, timestamp: 1_800_000_000n }),
  }),
}));

let words: { A: string; B: string; C: string; Z: string };

/** The fields of a set row, for the stand-in `createSet` (hoisted mocks can't reach `draft`). */
function draftLike(id: number) {
  return { id, status: "draft", revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null, words: [], stampAt: null, allowlistCount: 0 };
}

function draft(id: number, name: string, list: string[], over: Partial<WordSet> = {}): WordSet {
  return {
    id, name, status: "draft", revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: id,
    revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null,
    words: list.map((word) => ({ word, headliner: false })), ...STANDARD_FIELDS, ...over,
  };
}

const proofReq = (w: string) => new Request(`http://localhost/api/dictionary/proof?word=${w}`);
const verifies = (root: string, word: string, proof: string[]) => StandardMerkleTree.verify(root, ["string"], [word], proof);

beforeEach(async () => {
  vi.resetModules();
  const { WORDS } = await import("@/lib/dictionary");
  const { dictionaryRoot } = await import("@/lib/onchain/dictionaryTree");
  words = { A: WORDS[200], B: WORDS[201], C: WORDS[202], Z: WORDS[4000] };
  world.sets = [];
  world.roots.clear();
  world.migrated = true;
  world.fail = false;
  world.gate = false;
  world.gateUnreadable = false;
  world.gateOf = new Map();
  world.owned = new Set();
  world.ownedUnreadable = false;
  world.collab = true;
  world.stamps = new Map();
  world.lists = new Map();
  world.made = [];
  world.tokenDown = false;
  world.tokenAsked = [];
  const { tokenIdOf } = await import("@/lib/onchain/tokenId");
  world.ids = new Map(Object.values(words).map((w) => [tokenIdOf(w).toString(), w]));
  world.chainRoot = dictionaryRoot();
});

describe("reserving", () => {
  it("a word put in a set is held back at once, before any root is sent, and no other claim stops", async () => {
    world.sets = [draft(1, "Secret", [words.A, words.B])];
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const { dictionaryRoot } = await import("@/lib/onchain/dictionaryTree");

    const held = await GET(proofReq(words.A));
    expect(held.status).toBe(404);
    const body = await held.json();
    expect(body).toEqual({ ok: false, error: "not_released" }); // a plain "not yet": no proof, no set, no date

    const open = await (await GET(proofReq(words.Z))).json();
    expect(open.ok).toBe(true);
    expect(open.root).toBe(dictionaryRoot()); // still the chain's own tree
    expect(verifies(world.chainRoot, words.Z, open.proof)).toBe(true);
  });

  it("the reserve root leaves the words out: they have no proof in it, and everything else does", async () => {
    world.sets = [draft(1, "Secret", [words.A, words.B])];
    const { planReserve } = await import("@/lib/sets/server");
    const { treeWithout } = await import("@/lib/onchain/dictionaryTree");
    const { WORD_COUNT } = await import("@/lib/dictionary");

    const plan = await planReserve();
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.upToDate).toBe(false);
    expect(plan.removed).toEqual([words.A, words.B].sort());
    expect(plan.added).toEqual([]);
    expect(plan.intents.map((i) => i.signature)).toEqual(["setDictionaryRoot(bytes32)"]);
    expect(plan.intents[0].args[0].value).toBe(plan.root);
    // the row is stored BEFORE the plan is shown: the chain's root can be turned back into its tree
    expect(world.roots.get(plan.root)?.held).toEqual([words.A, words.B].sort());

    const tree = treeWithout(plan.removed);
    expect(tree.root.toLowerCase()).toBe(plan.root);
    expect(tree.size).toBe(WORD_COUNT - 2);
    expect(tree.proofFor(words.A)).toBeNull();
    expect(tree.proofFor(words.B)).toBeNull();

    world.chainRoot = plan.root; // the owner's transaction lands
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const { forgetSets } = await import("@/lib/sets/server");
    forgetSets();
    expect((await (await GET(proofReq(words.A))).json()).error).toBe("not_released");
    const z = await (await GET(proofReq(words.Z))).json();
    expect(z.root.toLowerCase()).toBe(plan.root);
    expect(verifies(plan.root, words.Z, z.proof)).toBe(true);
    // and a hand-made proof from the full tree is no use against the new root
    const { proofFor } = await import("@/lib/onchain/dictionaryTree");
    expect(verifies(plan.root, words.A, proofFor(words.A)!.proof)).toBe(false);
  });

  it("flags a word somebody already owns", async () => {
    world.sets = [draft(1, "Secret", [words.A, words.B])];
    world.owned = new Set([words.A]);
    const { planReserve } = await import("@/lib/sets/server");
    const plan = await planReserve();
    expect(plan.ok && plan.alreadyClaimed).toEqual([words.A]);
  });

  it("a draft edited after the root was sent waits for its own root, and stops nothing", async () => {
    world.sets = [draft(1, "Secret", [words.A])];
    const server = await import("@/lib/sets/server");
    const first = await server.planReserve();
    if (!first.ok) throw new Error("no plan");
    world.chainRoot = first.root;
    world.sets[0].words.push({ word: words.C, headliner: false }); // an edit, with no transaction yet
    server.forgetSets();

    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect((await GET(proofReq(words.Z))).status).toBe(200); // not dictionary_mismatch
    expect((await (await GET(proofReq(words.C))).json()).error).toBe("not_released");

    const next = await server.planReserve();
    expect(next.ok && next.removed).toEqual([words.C]);
    expect(next.ok && next.upToDate).toBe(false);
  });

  it("says so when the chain already holds back exactly what the sets say", async () => {
    world.sets = [draft(1, "Secret", [words.A])];
    const server = await import("@/lib/sets/server");
    const first = await server.planReserve();
    if (!first.ok) throw new Error("no plan");
    world.chainRoot = first.root;
    const again = await server.planReserve();
    expect(again.ok && again.upToDate).toBe(true);
    expect(again.ok && again.intents).toEqual([]);
  });
});

describe("releasing", () => {
  async function reserved() {
    world.sets = [draft(1, "First", [words.A, words.B]), draft(2, "Second", [words.C])];
    const server = await import("@/lib/sets/server");
    const plan = await server.planReserve();
    if (!plan.ok) throw new Error("no plan");
    world.chainRoot = plan.root;
    server.forgetSets();
    return { server, reserveRoot: plan.root };
  }

  it("the game's first answer after a release agrees with itself: the set is released AND its words are let go", async () => {
    const { server } = await reserved();
    world.sets[0].status = "revealed";
    server.forgetSets();
    const plan = await server.planRelease(1);
    if (!plan.ok) throw new Error("no plan");
    const { GET } = await import("@/app/api/dictionary/sets/route");
    // Before the transaction lands: revealed, and still held.
    const before = await (await GET()).json();
    expect(before.sets.find((x: { id?: number }) => x.id === 1).kind).toBe("revealed");
    expect(before.held).toContain(words.A);

    // It lands. The answer is built by ONE request that first read the sets as they were kept
    // (revealed) and then noticed the release: it must not say "revealed" beside a `held` list that
    // has already dropped the set's words (the game would count down on a set it lets you claim).
    world.chainRoot = plan.root;
    // Eleven seconds on: the chain's root is asked again (kept 10 s), the sets are not (kept 15 s).
    const at = Date.now() + 11_000;
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const after = await (await GET()).json();
    clock.mockRestore();
    expect(after.held).toEqual([words.C]); // the released set's words are let go; the other set stays held back
    expect(after.sets.find((x: { id?: number }) => x.id === 1).kind).toBe("released");
  });

  it("only a revealed set can be released", async () => {
    const { server } = await reserved();
    expect(await server.planRelease(1)).toEqual({ ok: false, error: "not_revealed" });
    expect(await server.planRelease(99)).toEqual({ ok: false, error: "not_found" });
  });

  it("the release root adds the set's words and removes none; the released words then have proofs", async () => {
    const { server, reserveRoot } = await reserved();
    world.sets[0].status = "revealed";
    server.forgetSets();
    const plan = await server.planRelease(1);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.added).toEqual([words.A, words.B].sort());
    expect(plan.gate).toBeNull(); // this network's Words has no gate yet
    expect(plan.gateNote).toMatch(/no gate yet/);
    expect(plan.intents.map((i) => i.signature)).toEqual(["setDictionaryRoot(bytes32)"]);

    // Release never removes a word: everything the old root proves, the new root proves too.
    const { treeWithout } = await import("@/lib/onchain/dictionaryTree");
    const { WORDS } = await import("@/lib/dictionary");
    const before = treeWithout(world.roots.get(reserveRoot)!.held);
    const after = treeWithout(world.roots.get(plan.root)!.held);
    expect(after.root.toLowerCase()).toBe(plan.root);
    expect(WORDS.filter((w) => before.has(w) && !after.has(w))).toEqual([]);
    expect(after.size).toBe(before.size + 2);
    expect(after.has(words.C)).toBe(false); // the other set stays held back

    // Until the transaction lands the set's words stay closed.
    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect((await (await GET(proofReq(words.A))).json()).error).toBe("not_released");

    world.chainRoot = plan.root; // the owner's transaction lands
    server.forgetSets();
    const a = await (await GET(proofReq(words.A))).json();
    expect(a.ok).toBe(true);
    expect(verifies(plan.root, words.A, a.proof)).toBe(true);
    expect(world.sets[0].status).toBe("released"); // marked from the chain, by the first read that saw it
    expect((await (await GET(proofReq(words.C))).json()).error).toBe("not_released");
  });

  it("a release whose root is one built before, for another reason, is still marked", async () => {
    // Reserve with only Second → root R1 (held: C). Then First is added and reserved → R2 (A, B, C).
    // Releasing First returns the chain to R1: the same root, built first as a "reserve".
    world.sets = [draft(2, "Second", [words.C])];
    const server = await import("@/lib/sets/server");
    const r1 = await server.planReserve();
    if (!r1.ok) throw new Error("no plan");
    world.sets.unshift(draft(1, "First", [words.A, words.B]));
    server.forgetSets();
    const r2 = await server.planReserve();
    if (!r2.ok) throw new Error("no plan");
    world.chainRoot = r2.root;
    world.sets[0].status = "revealed";
    server.forgetSets();

    const release = await server.planRelease(1);
    if (!release.ok) throw new Error("no release plan");
    expect(release.root).toBe(r1.root); // the earlier reserve root, again
    expect(world.roots.get(release.root)?.note).toBe("reserve"); // its row keeps its first note
    expect(await server.reconcile()).toEqual([]); // not on the chain yet

    world.chainRoot = release.root;
    expect(await server.reconcile()).toEqual([1]);
    expect(world.sets[0].status).toBe("released");
    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect((await GET(proofReq(words.A))).status).toBe(200);
    const again = await server.planReserve(); // and a reserve doesn't hold its words back again
    expect(again.ok && again.upToDate).toBe(true);
  });

  it("building the next release marks the one before it, and each release is marked once", async () => {
    const { server } = await reserved();
    world.sets[0].status = "revealed";
    world.sets[1].status = "revealed";
    server.forgetSets();
    const first = await server.planRelease(1);
    if (!first.ok) throw new Error("no plan");
    world.chainRoot = first.root;
    // Nobody presses "Check the chain": planning the second release reads the chain itself first,
    // so the second root is built on what the chain holds now (and can't hold the first set back).
    const second = await server.planRelease(2);
    if (!second.ok) throw new Error("no plan");
    expect(world.sets[0].status).toBe("released");
    expect(world.roots.get(second.root)?.held).toEqual([]); // the full dictionary again
    world.chainRoot = second.root;
    server.forgetSets();
    expect(await server.reconcile()).toEqual([2]);
    expect(await server.reconcile()).toEqual([]);
  });

  it("with the gate on this network's Words, the gate goes FIRST and the root second", async () => {
    const { server } = await reserved();
    world.gate = true;
    world.sets[0].status = "revealed";
    server.forgetSets();
    const now = 1_800_000_000;
    const plan = await server.planRelease(1, now);
    if (!plan.ok) throw new Error("no plan");
    expect(plan.intents.map((i) => i.signature)).toEqual(["setGate(uint256[],uint64)", "setDictionaryRoot(bytes32)"]);
    const { tokenIdOf } = await import("@/lib/onchain/tokenId");
    expect(plan.gate).toEqual({ until: now + 86_400, tokenIds: [words.A, words.B].map((w) => tokenIdOf(w).toString()), owned: [] });
    expect(plan.intents[0].args[0].value).toBe(`[${plan.gate!.tokenIds.join(",")}]`);
    expect(plan.intents[0].args[1].value).toBe(String(now + 86_400));
  });

  it("a word somebody already holds is left out of the gate (setGate would revert the whole release)", async () => {
    const { server } = await reserved();
    world.gate = true;
    world.owned = new Set([words.A]);
    world.sets[0].status = "revealed";
    server.forgetSets();
    const plan = await server.planRelease(1, 1_800_000_000);
    if (!plan.ok) throw new Error("no plan");
    const { tokenIdOf } = await import("@/lib/onchain/tokenId");
    expect(plan.gate?.tokenIds).toEqual([tokenIdOf(words.B).toString()]);
    expect(plan.gate?.owned).toEqual([words.A]);
    expect(plan.added).toEqual([words.A, words.B].sort()); // the root still adds every word
    expect(plan.intents.map((i) => i.fn)).toEqual(["setGate", "setDictionaryRoot"]);
  });

  it("no release plan when ownership can't be read: a gate that might revert is not built", async () => {
    const { server } = await reserved();
    world.gate = true;
    world.ownedUnreadable = true;
    world.sets[0].status = "revealed";
    server.forgetSets();
    const plan = await server.planRelease(1, 1_800_000_000);
    expect(!plan.ok && plan.error).toBe("chain_unreadable");
  });

  it("a gate that can't be read is never read as 'no gate': no release plan, and no mark", async () => {
    const { server } = await reserved();
    world.gate = true;
    world.sets[0].status = "revealed";
    server.forgetSets();
    world.gateUnreadable = true;
    const plan = await server.planRelease(1, 1_800_000_000);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.error).toBe("chain_unreadable"); // never the root alone

    // The release lands (built while the chain could be read), and then the chain can't say when
    // the gate lifts: the set is NOT marked released with "no gate". It is marked on a later look.
    world.gateUnreadable = false;
    const good = await server.planRelease(1, 1_800_000_000);
    if (!good.ok) throw new Error("no plan");
    world.chainRoot = good.root;
    world.gateUnreadable = true;
    expect(await server.reconcile()).toEqual([]);
    expect(world.sets[0].status).toBe("revealed");
    world.gateUnreadable = false;
    expect(await server.reconcile()).toEqual([1]);
    expect(world.sets[0].gateUntil).toEqual(new Date(1_900_000_000_000));
  });

  it("no release for a first day whose rule can't be checked: it would lock the set's words to everyone", async () => {
    const { server } = await reserved();
    world.gate = true;
    Object.assign(world.sets[0], { status: "revealed", gateRule: "allowlist", allowlistCount: 0 });
    server.forgetSets();
    expect(await server.planRelease(1)).toMatchObject({ ok: false, error: "gate_rule", detail: expect.stringMatching(/at least one wallet/) });
    Object.assign(world.sets[0], { gateRule: "token", gateToken: null, gateMin: null });
    server.forgetSets();
    expect(await server.planRelease(1)).toMatchObject({ ok: false, error: "gate_rule", detail: expect.stringMatching(/contract and a minimum/) });
    // A token rule whose contract doesn't answer on Base (a mistyped address): every balance read
    // would fail all day, so no release is built. With a contract that answers, it is.
    const TOKEN = "0x4444444444444444444444444444444444444444";
    Object.assign(world.sets[0], { gateRule: "token", gateToken: TOKEN, gateMin: "1" });
    world.tokenDown = true;
    server.forgetSets();
    expect(await server.planRelease(1)).toMatchObject({ ok: false, error: "gate_rule", detail: expect.stringMatching(/balanceOf/) });
    expect(world.tokenAsked).toEqual([TOKEN]);
    expect(world.sets[0].releaseRoot).toBeNull(); // nothing was recorded as built
    world.tokenDown = false;
    server.forgetSets();
    expect((await server.planRelease(1)).ok).toBe(true);
    world.sets[0].releaseRoot = null;
    // With its list filled the release is built, gate first.
    Object.assign(world.sets[0], { gateRule: "allowlist", allowlistCount: 3 });
    server.forgetSets();
    const plan = await server.planRelease(1);
    expect(plan.ok && plan.intents.map((i) => i.fn)).toEqual(["setGate", "setDictionaryRoot"]);
    // And where there is no first day at all, there is no rule to check.
    Object.assign(world.sets[0], { releaseRoot: null, gateHours: 0, gateRule: "allowlist", allowlistCount: 0 });
    server.forgetSets();
    expect((await server.planRelease(1)).ok).toBe(true);
  });

  it("a set with no gate hours gets no gate even where the contract has one", async () => {
    const { server } = await reserved();
    world.gate = true;
    world.sets[0].status = "revealed";
    world.sets[0].gateHours = 0;
    server.forgetSets();
    const plan = await server.planRelease(1);
    expect(plan.ok && plan.intents.map((i) => i.fn)).toEqual(["setDictionaryRoot"]);
  });

  it("a revealed set that was never reserved on the chain is not announced as released", async () => {
    world.sets = [draft(1, "Open", [words.A], { status: "revealed" })];
    const server = await import("@/lib/sets/server");
    expect(await server.reconcile()).toEqual([]); // the chain holds nothing back, but no release was built
    expect(world.sets[0].status).toBe("revealed");
  });

  it("and no release can be built for it: the reserve root comes first", async () => {
    world.sets = [draft(1, "Open", [words.A], { status: "revealed" })];
    const server = await import("@/lib/sets/server");
    const plan = await server.planRelease(1);
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.error).toBe("not_reserved");
    expect(world.roots.size).toBe(0); // nothing stored: a stored release root is what marks a release
    expect(await server.reconcile()).toEqual([]);
    expect(world.sets[0].status).toBe("revealed");
  });

  it("nor for a set only partly held back (a word added to it after the last reserve root)", async () => {
    const { server } = await reserved();
    world.sets[1].words.push({ word: words.Z, headliner: false }); // Second: C (held) and Z (not yet)
    world.sets[1].status = "revealed";
    server.forgetSets();
    const plan = await server.planRelease(2);
    expect(!plan.ok && plan.error).toBe("not_reserved");
  });
});

describe("the proof route says when a word is inside its set's first day", () => {
  const nowSec = () => Math.floor(Date.now() / 1000);
  it("carries `gate`, read from the CHAIN for that word, on a network whose Words has the gate", async () => {
    world.gate = true;
    const until = nowSec() + 3600;
    world.gateOf = new Map([[words.A, until]]);
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const a = await (await GET(proofReq(words.A))).json();
    expect(a.ok).toBe(true);
    expect(a.gate).toBe(until);
    expect("gate" in (await (await GET(proofReq(words.Z))).json())).toBe(false); // not gated on the chain
  });
  it("still says so just after a gate's end, so the chain's own clock decides (never this server's, or a phone's)", async () => {
    world.gate = true;
    world.gateOf = new Map([[words.A, nowSec() - 60], [words.B, nowSec() - 600]]);
    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect("gate" in (await (await GET(proofReq(words.A))).json())).toBe(true); // a minute past: ask the voucher route
    expect("gate" in (await (await GET(proofReq(words.B))).json())).toBe(false); // long past: the plain claim
  });
  it("doesn't depend on the sets table: a database outage on a chain holding the full root still says a word is gated", async () => {
    // After the last set is released the chain holds the full dictionary's root, and its words may
    // still be in their first day.
    world.gate = true;
    world.fail = true;
    world.gateOf = new Map([[words.A, nowSec() + 3600]]);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const a = await (await GET(proofReq(words.A))).json();
    expect(a.ok).toBe(true);
    expect(a.gate).toBe(world.gateOf.get(words.A));
    log.mockRestore();
  });
  it("serves no proof for a word whose gate can't be read: the plain claim might revert in the wallet", async () => {
    world.gate = true;
    world.gateUnreadable = true;
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const res = await GET(proofReq(words.A));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("try_again");
  });
  it("asks nothing and says nothing where the contract has no gate", async () => {
    world.gate = false; // this network's Words predates the gate: the plain claim is the claim
    world.gateOf = new Map([[words.A, nowSec() + 3600]]);
    world.gateUnreadable = true; // and it never even asks
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const body = await (await GET(proofReq(words.A))).json();
    expect(body.ok).toBe(true);
    expect("gate" in body).toBe(false);
  });
});

describe("when something can't be read", () => {
  it("no tables yet: no sets, and every answer is what it was before", async () => {
    world.migrated = false;
    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect((await GET(proofReq(words.A))).status).toBe(200);
    const { releasedWordCount } = await import("@/lib/sets/server");
    const { WORD_COUNT } = await import("@/lib/dictionary");
    expect(await releasedWordCount()).toBe(WORD_COUNT);
  });

  it("a failed read while the chain holds the full root stops no claim: nothing is held back there", async () => {
    world.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const res = await GET(proofReq(words.A));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(verifies(world.chainRoot, words.A, body.proof)).toBe(true);
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/ZEBRA|SECRETSET/);
    log.mockRestore();
  });

  it("a failed read with nothing kept, on a chain that holds words back, refuses and logs no word", async () => {
    // A reserve root is on the chain; then a cold server starts while the database is down.
    world.sets = [draft(1, "Secret", [words.A])];
    const first = await import("@/lib/sets/server");
    const plan = await first.planReserve();
    if (!plan.ok) throw new Error("no plan");
    world.chainRoot = plan.root;
    vi.resetModules();
    world.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const res = await GET(proofReq(words.A));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("try_again");
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/ZEBRA|SECRETSET/);
    log.mockRestore();
  });

  it("a failed read after a good one keeps what was held back", async () => {
    world.sets = [draft(1, "Secret", [words.A])];
    const server = await import("@/lib/sets/server");
    await server.loadSets({ fresh: true });
    world.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const book = await server.loadSets({ fresh: true });
    expect(book.known).toBe(true);
    expect(book.sets[0].words[0].word).toBe(words.A);
    log.mockRestore();
  });

  it("a root this server never built is dictionary_mismatch, as a re-vendor always was", async () => {
    world.chainRoot = "0x" + "ab".repeat(32);
    const { GET } = await import("@/app/api/dictionary/proof/route");
    const res = await GET(proofReq(words.Z));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("dictionary_mismatch");
  });

  it("and the reserve root is the way out of it: built from the sets alone, with no diff to list", async () => {
    world.chainRoot = "0x" + "ab".repeat(32);
    world.sets = [draft(1, "Secret", [words.A]), draft(2, "Shown", [words.B], { status: "revealed" })];
    const server = await import("@/lib/sets/server");
    const plan = await server.planReserve();
    if (!plan.ok) throw new Error("no plan");
    expect(plan).toMatchObject({ chainKnown: false, dictionaryChanged: false, upToDate: false, holds: 2, removed: [], added: [] });
    const { treeWithout } = await import("@/lib/onchain/dictionaryTree");
    expect(plan.root).toBe(treeWithout([words.A, words.B]).root.toLowerCase());
    expect(plan.intents).toHaveLength(1);
    // no release until the chain's tree is one this server can rebuild
    const release = await server.planRelease(2);
    expect(!release.ok && release.error).toBe("dictionary_mismatch");
    world.chainRoot = plan.root; // the reserve root lands: claims flow again
    server.forgetSets();
    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect((await GET(proofReq(words.Z))).status).toBe(200);
  });

  it("a stored root whose words no longer give it (the dictionary grew) is a mismatch too, and Reserve fixes it", async () => {
    // Stand-in for a re-vendor: a row for the chain's root whose words build a different tree.
    const stale = "0x" + "5e".repeat(32);
    world.roots.set(stale, { held: [words.A], note: "reserve", n: 0 });
    world.chainRoot = stale;
    world.sets = [draft(1, "Secret", [words.A]), draft(2, "Shown", [words.B], { status: "revealed" })];
    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect((await (await GET(proofReq(words.Z))).json()).error).toBe("dictionary_mismatch"); // never a proof that can't verify
    const server = await import("@/lib/sets/server");
    const plan = await server.planReserve();
    if (!plan.ok) throw new Error("no plan");
    expect(plan).toMatchObject({ chainKnown: true, dictionaryChanged: true, upToDate: false, removed: [words.B], added: [] });
    const release = await server.planRelease(2);
    expect(!release.ok && release.error).toBe("dictionary_mismatch");
  });
});

describe("the counts that say \"of the dictionary\"", () => {
  it("count released words only", async () => {
    world.sets = [draft(1, "Secret", [words.A, words.B]), draft(2, "Out", [words.C], { status: "released" })];
    const { releasedWordCount, releasedWords } = await import("@/lib/sets/server");
    const { WORD_COUNT } = await import("@/lib/dictionary");
    expect(await releasedWordCount()).toBe(WORD_COUNT - 2);
    const offered = await releasedWords();
    expect(offered).toHaveLength(WORD_COUNT - 2);
    expect(offered).not.toContain(words.A);
    expect(offered).toContain(words.C);
  });
});

describe("GET /api/dictionary/sets: what any visitor is told", () => {
  it("a draft is a locked slot; NOTHING else of an unrevealed set is in the answer", async () => {
    world.sets = [
      draft(1, "SecretName", [words.A, words.B], { revealAt: new Date("2027-03-04T05:06:07Z"), releaseAt: new Date("2027-04-05T06:07:08Z") }),
      draft(2, "Shown", [words.C], { status: "revealed", releaseAt: new Date("2026-12-24T00:00:00Z") }),
      draft(3, "EmptyDraft", []),
    ];
    const { GET } = await import("@/app/api/dictionary/sets/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("s-maxage=10"); // short: a stale held list keeps a released set closed in Spell
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.sets).toEqual([
      { kind: "locked" },
      { kind: "revealed", id: 2, name: "Shown", words: [{ word: words.C, headliner: false }], collab: null, firstDay: "verified", firstDayLabel: null, releaseAt: "2026-12-24T00:00:00.000Z" },
    ]);
    // Nothing of an unrevealed SET reaches a client response: not a draft's name, a date of it,
    // or how many words it has. (An empty draft isn't even a slot.)
    for (const secret of ["SecretName", "EmptyDraft", "2027-03-04", "2027-04-05"]) expect(text).not.toContain(secret);
    const { WORD_COUNT } = await import("@/lib/dictionary");
    expect(body.released).toBe(WORD_COUNT - 3);
    expect(body.total).toBe(WORD_COUNT);
    expect(body.gate).toBe(false);
    expect(Object.keys(body).sort()).toEqual(["gate", "held", "ok", "released", "sets", "total"]);
    // The words held back now are ONE flat list, A to Z, of every unreleased set together (the
    // owner's choice, 2026-11-26: the app must leave them out of Spell and the Dictionary, and
    // which words are held back can't be kept secret). It says nothing of which set a word is in:
    // a draft's words appear here and NOWHERE else in the answer.
    expect(body.held).toEqual([words.A, words.B, words.C].sort());
    const rest = JSON.stringify({ ...body, held: undefined });
    expect(rest).not.toContain(words.A);
    expect(rest).not.toContain(words.B);
  });

  it("a released set shows its words and its gate", async () => {
    const until = new Date(Date.now() + 3_600_000);
    world.sets = [draft(1, "Out", [words.A], { status: "released", releasedAt: new Date(0), gateUntil: until, perPlayerLimit: 2 })];
    const { GET } = await import("@/app/api/dictionary/sets/route");
    const body = await (await GET()).json();
    expect(body.sets).toEqual([
      {
        kind: "released", id: 1, name: "Out", words: [{ word: words.A, headliner: false }], collab: null, firstDay: "verified", firstDayLabel: null,
        releasedAt: new Date(0).toISOString(), gateUntil: until.toISOString(), perPlayerLimit: 2,
      },
    ]);
  });

  it("still shows the sets when the chain's root can't be served, with no count", async () => {
    world.sets = [draft(2, "Shown", [words.C], { status: "revealed" })];
    world.chainRoot = "0x" + "ab".repeat(32); // a root this server can't serve
    const { GET } = await import("@/app/api/dictionary/sets/route");
    const body = await (await GET()).json();
    expect(body.sets).toHaveLength(1);
    expect(body.released).toBeNull();
    expect(body.held).toBeNull(); // unknown, never "nothing is held"
  });

  it("can't read the sets is 503, never 'no sets'", async () => {
    world.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { GET } = await import("@/app/api/dictionary/sets/route");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("cache-control")).toBe("no-store");
    log.mockRestore();
  });
});

describe("/api/admin/sets is gated, and nothing private leaves without the gate", () => {
  const get = () => new Request("http://localhost/api/admin/sets");
  const post = (body: unknown) => new Request("http://localhost/api/admin/sets", { method: "POST", body: JSON.stringify(body) });

  it("refuses a caller with no credential, with no set in the answer", async () => {
    world.sets = [draft(1, "SecretName", [words.A])];
    vi.stubEnv("NEXT_PUBLIC_ADMIN_WALLETS", "0x00000000000000000000000000000000000000a1");
    try {
      const { GET, POST } = await import("@/app/api/admin/sets/route");
      for (const res of [await GET(get()), await POST(post({ action: "planReserve" })), await POST(post({ action: "import", text: "{}" }))]) {
        expect(res.status).toBe(401);
        expect(res.headers.get("cache-control")).toBe("no-store");
        const text = await res.text();
        expect(text).not.toContain("SecretName");
        expect(text).not.toContain(words.A);
      }
      expect(world.roots.size).toBe(0); // a refused planReserve built nothing
    } finally {
      vi.stubEnv("NEXT_PUBLIC_ADMIN_WALLETS", "");
    }
  });

  it("still shows the operator the sets when the chain holds a root nobody here built", async () => {
    world.sets = [draft(1, "SecretName", [words.A])];
    world.chainRoot = "0x" + "cd".repeat(32);
    const { GET, POST } = await import("@/app/api/admin/sets/route");
    const body = await (await GET(get())).json();
    expect(body.ok).toBe(true);
    expect(body.chain.known).toBe(false);
    expect(body.pending).toBeNull();
    expect(body.sets.map((s: { name: string }) => s.name)).toEqual(["SecretName"]);
    expect(body.file.sets).toHaveLength(1);
    const { commitmentOf } = await import("@/lib/sets/rules");
    expect(body.commitment).toBe(commitmentOf(world.sets));
    // and an edit's dates are checked against the set's saved dates, not against nothing
    world.sets[0].releaseAt = new Date("2026-12-01T00:00:00Z");
    const res = await POST(post({ action: "update", id: 1, revealAt: "2026-12-02T00:00:00Z" }));
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0]).toMatch(/before the release/);
    expect((await POST(post({ action: "update", id: 99, gateHours: 2 }))).status).toBe(404);
  });

  it("gives the operator the sets, the commitment, the export, and what waits for a root", async () => {
    world.sets = [draft(1, "SecretName", [words.A, words.B])];
    const { GET } = await import("@/app/api/admin/sets/route"); // no allowlist outside production: dev-open
    const res = await GET(get());
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.sets[0].name).toBe("SecretName");
    expect(body.pending).toEqual({ removed: 2, added: 0 });
    expect(body.sets[0].open.sort()).toEqual([words.A, words.B].sort()); // not reserved on the chain yet
    expect(body.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.file.sets[0].words).toEqual([words.A, words.B].sort());
    expect(body.chain.gate).toBe(false);
  });
});

describe("the collab words a rarity is read with", () => {
  const look = { type: "collab", partnerName: "P", colorA: "#112233", colorB: "#aabbcc", stampAt: new Date(0) } as const;
  it("are the words of revealed and released collab sets, and are UNKNOWN when the sets can't be read", async () => {
    world.sets = [draft(1, "Draft", [words.A], look), draft(2, "Shown", [words.B], { ...look, status: "revealed" }), draft(3, "Plain", [words.C], { status: "revealed" })];
    const server = await import("@/lib/sets/server");
    const now = await server.collabNow();
    expect(now.known).toBe(true);
    expect([...now.words.keys()]).toEqual([words.B]);
    // The same object carries the word's card look: one lookup for the rarity and the card.
    expect(now.words.get(words.B)).toMatchObject({ setId: 2, partner: "P", a: "#112233", b: "#aabbcc" });
    // Unreadable, with nothing kept from before: unknown, never "no collab words".
    vi.resetModules();
    world.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const fresh = await import("@/lib/sets/server");
    const got = await fresh.collabNow();
    expect(got.known).toBe(false);
    expect(got.words.size).toBe(0);
    log.mockRestore();
  });
  it("a caller that PAYS gets this call's own read or a throw: never the copy kept from before a failure", async () => {
    world.sets = [draft(2, "Shown", [words.B], { ...look, status: "revealed" })];
    const server = await import("@/lib/sets/server");
    expect([...(await server.collabStrict()).keys()]).toEqual([words.B]); // and this read is now the kept copy
    world.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // The ordinary read answers from the kept copy and calls it known: right for holding words back...
    const kept = await server.collabNow();
    expect(kept.known).toBe(true);
    expect([...kept.words.keys()]).toEqual([words.B]);
    // ...and exactly what the keeper must not weigh an epoch with.
    await expect(server.collabStrict()).rejects.toThrow(/couldn't be read/);
    const { epochTiers } = await import("@/lib/keeper/tiers");
    await expect(epochTiers("yield epoch 9", undefined, async () => {})).rejects.toThrow(/no epoch is opened/);
    // Back up: the next run reads, and weighs by the collab words.
    world.fail = false;
    const { wordsByTier } = await import("@/lib/economy");
    world.sets = [draft(2, "Shown", [wordsByTier("Common")[0]], { ...look, status: "revealed" })];
    expect((await epochTiers("yield epoch 10", undefined, async () => {}))(wordsByTier("Common")[0])).toBe("Legendary");
    log.mockRestore();
  });

  it("a picture that only SHOWS a rarity falls back to the derived tiers; it never fails or waits long", async () => {
    world.sets = [draft(2, "Shown", [words.B], { ...look, status: "revealed" })];
    const { collabSoon } = await import("@/lib/raritySoon");
    expect([...(await collabSoon()).keys()]).toEqual([words.B]);
    vi.resetModules();
    world.fail = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const again = await import("@/lib/raritySoon");
    expect((await again.collabSoon()).size).toBe(0);
    log.mockRestore();
  });
  it("the server's card picture, the Telegram alert, and the word answer use them", async () => {
    const { wordsByTier, TIER_COUNTS } = await import("@/lib/economy");
    const common = wordsByTier("Common")[0];
    const collab = new Set([common]);
    const { cardTier } = await import("@/app/_og/wordCard");
    const tiles = [...common].map((char) => ({ char, upper: false }));
    expect(cardTier(tiles, collab)).toBe("Legendary");
    expect(cardTier(tiles, new Set())).toBe("Common");
    expect(cardTier([..."HEYOO"].map((char) => ({ char, upper: true })), collab)).toBeUndefined(); // a house card has no rarity
    const { wordText } = await import("@/lib/telegramCommands");
    expect(wordText(common, undefined, false, false, collab)).toBe(`${common} is one of ${TIER_COUNTS.Legendary + 1} Legendary words.`);
    expect(wordText(common, undefined, false)).toBe(`${common} is one of ${TIER_COUNTS.Common.toLocaleString("en-US")} Common words.`);
    const { alertPost, isAlertWord, ALERT_TIERS } = await import("@/lib/telegramAlerts");
    expect(isAlertWord(common, collab)).toBe(ALERT_TIERS.includes("Legendary"));
    expect(alertPost({ word: common, upper: [false, false, false, false, false] }, "ann", collab).text).toContain(`one of the game’s ${TIER_COUNTS.Legendary + 1} Legendary words.`);
  });
});

describe("collab sets: what leaves the server, and what the operator may store", () => {
  const post = (body: unknown) => new Request("http://localhost/api/admin/sets", { method: "POST", body: JSON.stringify(body) });
  const collab = { type: "collab", partnerName: "SecretPartner", partnerUrl: "https://partner.example/", colorA: "#123456", colorB: "#abcdef", stampAt: new Date(1_800_000_000_000) } as const;
  const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
  const stampReq = (id: string) => [new Request(`http://localhost/api/sets/${id}/stamp`), { params: Promise.resolve({ id }) }] as const;

  it("NOTHING of a draft collab reaches the game: not that it is one, its partner, a color, its link, or its rule", async () => {
    const five = (await import("@/lib/dictionary")).WORDS.slice(300, 305);
    world.sets = [draft(1, "SecretName", five, { ...collab, gateRule: "token", gateToken: "0x4444444444444444444444444444444444444444", gateMin: "77", gateLabel: "SecretLabel" })];
    const { GET } = await import("@/app/api/dictionary/sets/route");
    const text = await (await GET()).text();
    expect(JSON.parse(text).sets).toEqual([{ kind: "locked" }]);
    for (const secret of ["SecretName", "SecretPartner", "partner.example", "123456", "abcdef", "collab", "stamp", "SecretLabel", "4444444444", "token"]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("a revealed collab says its partner, its colors, and where its stamp is; never its token's contract or a wallet on its list", async () => {
    const five = (await import("@/lib/dictionary")).WORDS.slice(300, 305);
    world.sets = [draft(1, "Shown", five, { ...collab, status: "revealed", gateRule: "token", gateToken: "0x4444444444444444444444444444444444444444", gateMin: "77", gateLabel: "holders of a test token" })];
    const { GET } = await import("@/app/api/dictionary/sets/route");
    const text = await (await GET()).text();
    const set = JSON.parse(text).sets[0];
    expect(set.collab).toEqual({ partner: "SecretPartner", url: "https://partner.example/", colorA: "#123456", colorB: "#abcdef", stamp: "/api/sets/1/stamp?v=1800000000" });
    expect(set.firstDay).toBe("token");
    expect(set.firstDayLabel).toBe("holders of a test token");
    expect(text).not.toContain("4444444444");
    expect(text).not.toContain('"77"');
  });

  it("a draft's stamp has no address: the same answer as a set that doesn't exist", async () => {
    world.sets = [draft(1, "SecretName", [words.A], collab)];
    world.stamps.set(1, { mime: "image/png", base64: PNG.toString("base64") });
    const { GET } = await import("@/app/api/sets/[id]/stamp/route");
    const hidden = await GET(...stampReq("1"));
    const missing = await GET(...stampReq("99"));
    expect([hidden.status, missing.status]).toEqual([404, 404]);
    expect(await hidden.text()).toBe("");
    expect((await GET(...stampReq("1; drop"))).status).toBe(404);

    world.sets[0].status = "revealed";
    const shown = await GET(...stampReq("1"));
    expect(shown.status).toBe(200);
    expect(shown.headers.get("content-type")).toBe("image/png");
    expect(shown.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await shown.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("the server's pictures are handed a revealed set's stamp as bytes; a draft's, and stored markup, never", async () => {
    world.sets = [draft(1, "SecretName", [words.A], collab)];
    world.stamps.set(1, { mime: "image/png", base64: PNG.toString("base64") });
    const { stampDataOf } = await import("@/lib/sets/stampData");
    const look = { setId: 1, mark: "1-1800000000", stamp: "/api/sets/1/stamp?v=1800000000" };
    expect(await stampDataOf(look)).toBeNull(); // a draft: as private as its name
    world.sets[0].status = "revealed";
    expect(await stampDataOf(look)).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    // a revealed set's stamp can't change: it is read once and kept
    world.stamps.delete(1);
    expect(await stampDataOf(look)).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    // a set with no stamp asks for nothing
    expect(await stampDataOf({ setId: 2, mark: "2-0", stamp: null })).toBeNull();
    // and bytes that are no picture are never handed to the renderer, whatever the row says they are
    world.sets.push(draft(3, "Shown", [words.B], { ...collab, status: "revealed" }));
    world.stamps.set(3, { mime: "image/png", base64: Buffer.from("<svg onload=alert(1)>").toString("base64") });
    expect(await stampDataOf({ setId: 3, mark: "3-1", stamp: "/api/sets/3/stamp?v=1" })).toBeNull();
  });

  it("serves a stamp as what its bytes are, never as what the row says: stored markup is served as nothing", async () => {
    world.sets = [draft(1, "Shown", [words.A], { ...collab, status: "revealed" })];
    world.stamps.set(1, { mime: "image/svg+xml", base64: Buffer.from("<svg onload=alert(1)>").toString("base64") });
    const { GET } = await import("@/app/api/sets/[id]/stamp/route");
    expect((await GET(...stampReq("1"))).status).toBe(404);
  });

  it("takes a stamp only when its own bytes are a PNG or a JPEG, and small", async () => {
    world.sets = [draft(1, "Draft", [words.A], { type: "collab" })];
    const { POST } = await import("@/app/api/admin/sets/route");
    const { STAMP_MAX_BYTES } = await import("@/lib/sets/rules");
    const send = async (bytes: Buffer) => (await POST(post({ action: "stamp", id: 1, data: bytes.toString("base64") }))).status;
    expect(await send(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>'))).toBe(400);
    expect(await send(Buffer.from("GIF89a...."))).toBe(400);
    expect(await send(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBPVP8 "))).toBe(400); // not until the server's pictures are known to draw it
    expect(await send(Buffer.concat([PNG, Buffer.alloc(STAMP_MAX_BYTES)]))).toBe(400); // too big
    expect(world.stamps.size).toBe(0);
    expect(await send(PNG)).toBe(200);
    expect(world.stamps.get(1)).toEqual({ mime: "image/png", base64: PNG.toString("base64"), bytes: PNG.length });
    // The operator's own read carries the picture for the preview; the game's read has no address for a draft's.
    const { GET } = await import("@/app/api/admin/sets/route");
    const admin = await (await GET(new Request("http://localhost/api/admin/sets"))).json();
    expect(admin.sets[0].stamp).toBe(`data:image/png;base64,${PNG.toString("base64")}`);
    // Once the set is revealed its stamp is locked, like its name.
    world.sets[0].status = "revealed";
    expect(await send(PNG)).toBe(409);
  });

  it("takes an allowlist as a paste, and never gives a wallet back", async () => {
    world.sets = [draft(1, "Draft", [words.A], { gateRule: "allowlist" })];
    const { GET, POST } = await import("@/app/api/admin/sets/route");
    const A1 = "0x00000000000000000000000000000000000000A1";
    const res = await POST(post({ action: "allowlist", id: 1, text: `${A1}\n${A1.toLowerCase()}, 0x00000000000000000000000000000000000000b2 nonsense` }));
    expect(await res.json()).toEqual({ ok: true, wallets: 2, bad: 1 });
    expect(world.lists.get(1)).toEqual([A1.toLowerCase(), "0x00000000000000000000000000000000000000b2"]);
    const text = await (await GET(new Request("http://localhost/api/admin/sets"))).text();
    expect(JSON.parse(text).sets[0].allowlistCount).toBe(2);
    expect(text.toLowerCase()).not.toContain("00000000000000000000000000000000000000b2");
  });

  it("tells the operator what a collab draft still needs, and what a revealed set's first day still needs", async () => {
    world.sets = [
      draft(1, "Half", [words.A], { type: "collab", partnerName: "P" }),
      draft(2, "Shown", [words.B], { status: "revealed", gateRule: "allowlist" }),
    ];
    const { GET } = await import("@/app/api/admin/sets/route");
    const body = await (await GET(new Request("http://localhost/api/admin/sets"))).json();
    expect(body.collab).toBe(true);
    expect(body.sets[0].needs).toEqual([
      "a collab set can be revealed once the collab card ships (a draft can be made and edited now)",
      "a collab set has exactly 5 words (this one has 1)",
      "a collab set needs its two colors",
      "a collab set needs its stamp",
    ]);
    expect(body.sets[1].needs).toEqual(["the allowlist rule needs at least one wallet on the list"]);
  });

  it("the placeholder “Test collab” is made on a test network only, as a draft, with words nobody holds and no set has", async () => {
    const { WORDS } = await import("@/lib/dictionary");
    const { wordTier } = await import("@/lib/economy");
    world.sets = [draft(1, "Other", [words.A])];
    {
      const { POST } = await import("@/app/api/admin/sets/route"); // this file's network is Base Sepolia
      const { tokenIdOf } = await import("@/lib/onchain/tokenId");
      world.ids = new Map(WORDS.map((w) => [tokenIdOf(w).toString(), w]));
      // Somebody owns every Mythic word but one, and a few lower ones.
      const mythic = WORDS.filter((w) => wordTier(w) === "Mythic");
      world.owned = new Set(mythic.slice(1, 40));
      const res = await POST(post({ action: "testCollab" }));
      expect(res.status).toBe(200);
      const made = world.sets.find((s) => s.name === "Test collab")!;
      expect(made.status).toBe("draft");
      expect(made).toMatchObject({ type: "collab", partnerName: "Test partner", colorA: "#1f6f8b", colorB: "#f2a65a" });
      expect(made.words).toHaveLength(5);
      for (const w of made.words) {
        expect(world.owned.has(w.word)).toBe(false);
        expect(w.word).not.toBe(words.A);
        expect(wordTier(w.word)).not.toBe("Legendary");
      }
      expect(made.words.filter((w) => wordTier(w.word) === "Mythic").map((w) => w.word)).toEqual([mythic[0]]);
      const { sniffStamp, revealProblems } = await import("@/lib/sets/rules");
      expect(sniffStamp(Buffer.from(world.stamps.get(made.id)!.base64, "base64"))).toBe("image/png");
      expect(revealProblems(made, true)).toEqual([]); // whole: once the collab card ships, the operator can reveal it as it is
      // Once is enough.
      expect(await (await POST(post({ action: "testCollab" }))).json()).toMatchObject({ ok: false, error: "exists" });
    }
  });

  it("and never on mainnet", async () => {
    vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "8453");
    try {
      const { POST } = await import("@/app/api/admin/sets/route");
      const res = await POST(post({ action: "testCollab" }));
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ ok: false, error: "not_testnet" });
      expect(world.made).toEqual([]);
    } finally {
      vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532"); // this file's network again
    }
  });

  it("before migration 0023 the operator is told, and the sets still read", async () => {
    world.collab = false;
    world.sets = [draft(1, "Plain", [words.A])];
    const { GET, POST } = await import("@/app/api/admin/sets/route");
    const body = await (await GET(new Request("http://localhost/api/admin/sets"))).json();
    expect(body).toMatchObject({ ok: true, migrated: true, collab: false });
    expect(body.sets[0].type).toBe("standard");
    expect(await (await POST(post({ action: "testCollab" }))).json()).toEqual({ ok: false, error: "not_migrated" });
    expect(world.made).toEqual([]);
  });
});
