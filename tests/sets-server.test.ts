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
import type { WordSet } from "@/lib/sets/rules";

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
}));

vi.mock("@/lib/db/sets", () => {
  class SetError extends Error {
    constructor(public code: string, public words: string[] = []) {
      super(code);
    }
  }
  return {
    SetError,
    listSets: async () => {
      // A driver's error names the statement's parameters: the words. It must never be logged whole.
      if (world.fail) throw Object.assign(new Error("Failed query … params: ZEBRA,SECRETSET"), { code: "08006" });
      return { sets: world.sets.map((s) => ({ ...s, words: [...s.words] })), migrated: world.migrated };
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

function draft(id: number, name: string, list: string[], over: Partial<WordSet> = {}): WordSet {
  return {
    id, name, status: "draft", revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: id,
    revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null, releaseRoot: null,
    words: list.map((word) => ({ word, headliner: false })), ...over,
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
    expect(res.headers.get("cache-control")).toContain("s-maxage=30");
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.sets).toEqual([
      { kind: "locked" },
      { kind: "revealed", id: 2, name: "Shown", words: [{ word: words.C, headliner: false }], releaseAt: "2026-12-24T00:00:00.000Z" },
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
      { kind: "released", id: 1, name: "Out", words: [{ word: words.A, headliner: false }], releasedAt: new Date(0).toISOString(), gateUntil: until.toISOString(), perPlayerLimit: 2 },
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
