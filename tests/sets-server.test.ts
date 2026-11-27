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
  owned: new Set<string>(),
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
    setsWithReleaseRoot: async () =>
      new Set([...world.roots.values()].filter((r) => r.note.startsWith("release:")).map((r) => Number(r.note.slice(8)))),
    markReleased: async (_c: number, id: number, at: { releasedAt: Date; gateUntil: Date | null; releaseBlock: number | null }) => {
      const s = world.sets.find((x) => x.id === id);
      if (!s || s.status !== "revealed") return false;
      Object.assign(s, { status: "released", ...at });
      return true;
    },
  };
});

vi.mock("@/lib/onchain/reads", async (orig) => ({
  ...(await orig<typeof import("@/lib/onchain/reads")>()),
  getPublicClient: () => ({
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "dictionaryRoot") return world.chainRoot;
      if (functionName === "claimSigner") {
        if (!world.gate) throw new Error("execution reverted"); // a Words deployed before the gate
        return "0x00000000000000000000000000000000000000aa";
      }
      throw new Error(`unexpected read ${functionName}`);
    },
    multicall: async ({ contracts }: { contracts: { functionName: string }[] }) =>
      contracts.map((c) => (c.functionName === "gatedUntil" ? { status: "success", result: 1_900_000_000n } : false)),
    getBlockNumber: async () => 1000n,
    getLogs: async () => [],
    getBlock: async () => ({ number: 1000n, timestamp: 1_800_000_000n }),
  }),
}));

let words: { A: string; B: string; C: string; Z: string };

function draft(id: number, name: string, list: string[], over: Partial<WordSet> = {}): WordSet {
  return {
    id, name, status: "draft", revealAt: null, releaseAt: null, gateHours: 24, perPlayerLimit: 1, sort: id,
    revealedAt: null, releasedAt: null, gateUntil: null, releaseBlock: null,
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
    world.sets = [draft(1, "Secret", [words.A])];
    const reads = await import("@/lib/onchain/reads");
    const client = reads.getPublicClient() as unknown as { multicall: unknown };
    vi.spyOn(reads, "getPublicClient").mockReturnValue({ ...(client as object), multicall: async () => [true] } as never);
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
    expect(plan.gate).toEqual({ until: now + 86_400, tokenIds: [words.A, words.B].map((w) => tokenIdOf(w).toString()) });
    expect(plan.intents[0].args[0].value).toBe(`[${plan.gate!.tokenIds.join(",")}]`);
    expect(plan.intents[0].args[1].value).toBe(String(now + 86_400));
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

describe("when something can't be read", () => {
  it("no tables yet: no sets, and every answer is what it was before", async () => {
    world.migrated = false;
    const { GET } = await import("@/app/api/dictionary/proof/route");
    expect((await GET(proofReq(words.A))).status).toBe(200);
    const { releasedWordCount } = await import("@/lib/sets/server");
    const { WORD_COUNT } = await import("@/lib/dictionary");
    expect(await releasedWordCount()).toBe(WORD_COUNT);
  });

  it("a failed read with nothing kept refuses, and logs no word", async () => {
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
