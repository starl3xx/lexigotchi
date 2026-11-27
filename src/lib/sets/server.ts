/**
 * Reserved word sets on the server: which words the game offers now, which tree a claim's proof
 * comes from, and the root changes the owner sends (decisions.md, "Reserved word sets").
 *
 * TWO sources decide whether a word is available, and both must say yes:
 *  1. THE CHAIN. `Words.claim` checks a proof against `Words.dictionaryRoot`, so a proof is only
 *     worth serving from the tree behind the root the chain holds NOW. Every root this server
 *     builds is stored with the words it leaves out (`dictionary_roots`), so the tree can be
 *     rebuilt from the chain's root alone. A root nobody here built is `dictionary_mismatch`, as a
 *     re-vendored dictionary always was.
 *  2. THE SETS TABLE. A word in any set that isn't released is held back at once, before the owner
 *     has sent the root that enforces it. (Until that root lands, the chain would still take a
 *     proof someone built by hand: the admin says "root out of date" for as long.)
 * So a draft edit never stops a claim: the sets move at once, the chain moves when the owner sends
 * `setDictionaryRoot`, and proofs follow the chain throughout.
 *
 * No database here (a local or rehearsal build), or no tables yet (migration 0021 hasn't run):
 * no sets, and every answer is what it was before sets existed. A database that is configured and
 * FAILS is different: with nothing kept from an earlier read, the answer is `try_again`, never the
 * full dictionary, UNLESS the chain itself holds the full dictionary's root (then nothing is held
 * back on the chain, and a claim is served as it always was).
 *
 * Nothing in this file logs a word.
 */
import { getAbiItem } from "viem";
import { WORDS, WORD_COUNT, isWord } from "@/lib/dictionary";
import { dictionaryRoot, treeWithout, type DictionaryTree } from "@/lib/onchain/dictionaryTree";
import { addressOf, deployBlock, isSuiteDeployed, wordsHaveGate } from "@/lib/onchain/addresses";
import { getPublicClient } from "@/lib/onchain/reads";
import { getLogsAdaptive } from "@/lib/onchain/logs";
import { wordsAbi } from "@/lib/onchain/abis";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { NETWORK } from "@/lib/onchain/network";
import type { TxIntent } from "@/lib/admin/tx";
import { heldOfRoot, listSets, markReleased, newestRoot, revealDue, saveRoot, setReleaseRoot } from "@/lib/db/sets";
import { tokenReadable } from "./firstDay";
import { NO_COLLAB } from "@/lib/rarity";
import { collabLooksOf, type CollabLooks } from "@/lib/collabLook";
import { dueToReveal, gateUntilFor, heldOf, publicSets, releaseChange, releaseProblems, reserveChange, revealProblems, type WordSet } from "./rules";

const BOOK_TTL_MS = 15_000;
// Short: after the owner changes the root (a reserve, a release), a proof from the old tree
// reverts in the wallet, for every word, until this server reads the new root. A release is the
// busiest minute a set has.
const ROOT_TTL_MS = 10_000;

/** A short, word-free note of a failure. A driver's message can carry a statement's parameters. */
function codeOf(err: unknown): string {
  const e = err as { code?: string; cause?: { code?: string }; name?: string } | null;
  return String(e?.code ?? e?.cause?.code ?? e?.name ?? "error").slice(0, 40);
}

// --- the sets ---------------------------------------------------------------------------------

export interface SetsBook {
  sets: WordSet[];
  /** False: migration 0021 hasn't run here (or there is no database at all). */
  migrated: boolean;
  /** False: migration 0023 (what a collab set adds) hasn't run here. Every set then reads as a standard one. */
  collab: boolean;
  /** False: the database is there and couldn't be read, and nothing is kept from before. */
  known: boolean;
}

let book: { at: number; value: SetsBook } | null = null;

/** Forget what is kept (after a change, and in tests). */
export function forgetSets(): void {
  book = null;
  chainRoot = null;
  lastReconciled = null;
}

/**
 * The sets, kept for a few seconds. A draft whose reveal time has come is revealed on the way
 * (one statement, so two servers reveal it once).
 *
 * `strict`: this call's OWN read, or a throw. Never the copy kept from an earlier read, which is
 * what an ordinary caller gets when the database fails (right for holding words back, wrong for a
 * caller that pays by what the sets say now).
 */
export async function loadSets(opts: { fresh?: boolean; strict?: boolean } = {}): Promise<SetsBook> {
  if (!process.env.DATABASE_URL) return { sets: [], migrated: false, collab: false, known: true };
  if (!opts.fresh && book && Date.now() - book.at < BOOK_TTL_MS) return book.value;
  try {
    let read = await listSets(NETWORK.id);
    const now = new Date();
    // Only a set that CAN be revealed: a collab that is missing a part stays a draft however late
    // it is, and must not make every read of the sets run the reveal again.
    const due = read.sets.filter((s) => dueToReveal(s, now) && revealProblems(s).length === 0);
    if (due.length > 0) {
      // And only one the chain holds back already (see heldOnChain): a set whose reserve root hasn't
      // landed stays a draft past its date, and the first read after the root reveals it. This
      // look only spares the database a reveal that would change nothing; the check that counts
      // is revealSet's own, under the set's lock.
      const held = await heldOnChain();
      if (held && due.some((s) => s.words.every((w) => held.has(w.word)))) {
        await revealDue(NETWORK.id, now, held);
        read = await listSets(NETWORK.id);
      }
    }
    const value: SetsBook = { ...read, known: true };
    book = { at: Date.now(), value };
    return value;
  } catch (err) {
    console.error("[sets] the sets couldn't be read:", codeOf(err));
    if (opts.strict) throw new Error(`the sets couldn't be read (${codeOf(err)})`);
    // What was read before still holds back everything it held back then: a set released since
    // stays closed a little longer, and nothing opens early.
    if (book) return book.value;
    return { sets: [], migrated: true, collab: true, known: false };
  }
}

/**
 * The words the collab layer raises to Legendary right now (lib/rarity.ts): every word of a
 * REVEALED or RELEASED collab set. `known: false` when the sets couldn't be read: a caller that
 * only shows a rarity may fall back to the derived tiers, and a caller that PAYS by rarity (the
 * keeper's yield and bounty) must not open an epoch on a guess.
 */
export async function collabNow(): Promise<{ known: boolean; words: CollabLooks }> {
  const book = await loadSets();
  // Through `publicSets`, like everything a visitor may be told: a draft has no look to give.
  return { known: book.known, words: book.known ? collabLooksOf(publicSets(book.sets)) : NO_COLLAB };
}

/**
 * The same words for a caller that PAYS by rarity (the keeper): read now, by this call, or a
 * throw. `collabNow` can answer from a copy kept before the database failed, and says "known";
 * an epoch must not be weighed with that.
 *
 * With no database configured there are no sets at all, so there are no collab words: that is a
 * fact, not a guess (and an epoch's proofs are stored in the same database before it is opened,
 * so a keeper without one opens nothing).
 */
export async function collabStrict(): Promise<CollabLooks> {
  return collabLooksOf(publicSets((await loadSets({ fresh: true, strict: true })).sets));
}

// --- the chain's root -------------------------------------------------------------------------

let chainRoot: { at: number; value: string } | null = null;

/** `Words.dictionaryRoot()`, lowercase, read at most every few seconds. Null: no suite here, or the read failed. */
export async function readChainRoot(opts: { fresh?: boolean } = {}): Promise<string | null> {
  if (!isSuiteDeployed()) return null;
  if (!opts.fresh && chainRoot && Date.now() - chainRoot.at < ROOT_TTL_MS) return chainRoot.value;
  try {
    const value = String(
      await getPublicClient().readContract({ address: addressOf("words"), abi: wordsAbi, functionName: "dictionaryRoot" }),
    ).toLowerCase();
    chainRoot = { at: Date.now(), value };
    return value;
  } catch {
    return null; // can't tell: the contract still has the final word on every claim
  }
}

/** What each root leaves out. A root's list never changes, so it is kept for the server's life. */
const heldByRoot = new Map<string, string[]>();

/** The words `root` leaves out; null when this server never built that root. Throws on a failed read. */
async function heldBehind(root: string): Promise<string[] | null> {
  if (root === dictionaryRoot().toLowerCase()) return [];
  const kept = heldByRoot.get(root);
  if (kept) return kept;
  if (!process.env.DATABASE_URL) return null;
  const held = await heldOfRoot(NETWORK.id, root);
  if (held) heldByRoot.set(root, held);
  return held;
}

// --- what is served ---------------------------------------------------------------------------

export type Serving =
  | {
      ok: true;
      /** The tree behind the chain's root: where a claim's proof comes from. */
      tree: DictionaryTree;
      /** The chain's root, or null when it couldn't be asked. */
      chainRoot: string | null;
      /** The words the chain's root leaves out. */
      chainHeld: ReadonlySet<string>;
      /** Every word the game holds back now: the chain's, and every unreleased set's. */
      held: ReadonlySet<string>;
      book: SetsBook;
    }
  | { ok: false; error: "dictionary_mismatch" | "try_again" };

let lastReconciled: string | null = null;

/**
 * The words the chain's dictionary root leaves out right now. Null when that can't be told: the
 * chain couldn't be asked, or its root is one this server never built.
 *
 * EVERY reveal is checked against it (lib/db/sets `revealSet`, under the set's row lock). A reveal
 * names a set's words to everyone, and until the chain's root leaves a word out anyone can claim
 * it straight from the contract with a proof made from the public dictionary (this server
 * refusing the proof stops only the game). So the reserve root goes on the chain BEFORE the
 * reveal: by hand a reveal is refused until then, and on its date a set is passed by and revealed
 * by the first read after the root lands. "Can't tell" is never "held back": no reveal.
 */
export async function heldOnChain(opts: { fresh?: boolean } = {}): Promise<ReadonlySet<string> | null> {
  const root = await readChainRoot(opts);
  if (!root) return null;
  try {
    const held = await heldBehind(root);
    return held ? new Set(held) : null;
  } catch {
    return null;
  }
}

/** The tree to serve proofs from, and everything held back. See the file's header for the rules. */
export async function serving(): Promise<Serving> {
  let sets = await loadSets();
  const root = await readChainRoot();
  if (!sets.known) {
    // The sets can't be read and nothing is kept from before. If the chain holds the FULL
    // dictionary's root, no word is held back on the chain, and a claim needs nothing from the
    // database: serve it as it was always served. (A word waiting in a set for its reserve root
    // is claimable on the chain anyway until that root lands.) So a database outage can't stop
    // claims on a deployment that reserves nothing. Any other root needs its row: refuse.
    if (root === dictionaryRoot().toLowerCase()) {
      return { ok: true, tree: treeWithout([]), chainRoot: root, chainHeld: new Set(), held: new Set(), book: { sets: [], migrated: true, collab: true, known: false } };
    }
    return { ok: false, error: "try_again" };
  }
  let chainHeld: string[];
  if (root) {
    let found: string[] | null;
    try {
      found = await heldBehind(root);
    } catch (err) {
      console.error("[sets] a root's words couldn't be read:", codeOf(err));
      return { ok: false, error: "try_again" };
    }
    if (!found) return { ok: false, error: "dictionary_mismatch" };
    // The stored words must still GIVE that root. After a re-vendor (the bundled dictionary grew)
    // they don't: the tree built here has leaves the chain's root has never seen, and every proof
    // from it would revert. Same answer as a re-vendor always got, until the owner sends the new
    // reserve root.
    if (treeWithout(found).root.toLowerCase() !== root) return { ok: false, error: "dictionary_mismatch" };
    chainHeld = found;
    // A new root on the chain may be a release: mark it, once per root this server sees.
    if (root !== lastReconciled && sets.sets.some((s) => s.status === "revealed")) {
      lastReconciled = root;
      try {
        if ((await reconcile()).length > 0) sets = await loadSets();
      } catch (err) {
        console.error("[sets] a release couldn't be marked:", codeOf(err));
      }
    }
  } else {
    // The chain can't be asked. The newest root built here is the best guess at what it holds; the
    // contract still decides every claim.
    try {
      chainHeld = sets.migrated ? ((await newestRoot(NETWORK.id))?.held ?? []) : [];
    } catch {
      chainHeld = [];
    }
  }
  const held = new Set(chainHeld);
  for (const w of heldOf(sets.sets)) held.add(w);
  return { ok: true, tree: treeWithout(chainHeld), chainRoot: root, chainHeld: new Set(chainHeld), held, book: sets };
}

/**
 * How many words the game offers now: the dictionary less every held-back word. Everything that
 * says "of the dictionary" to a player counts against this (decisions.md: "% of the dictionary
 * claimed", the free-letter stop). When it can't be worked out, the whole dictionary: an outage
 * must never make the game look fuller than it is and stop free letters for everyone.
 */
export async function releasedWordCount(): Promise<number> {
  const s = await serving().catch(() => null);
  return s?.ok ? WORD_COUNT - s.held.size : WORD_COUNT;
}

/** The words the game offers now, A to Z. Null when it can't be worked out. */
export async function releasedWords(): Promise<string[] | null> {
  const s = await serving().catch(() => null);
  return s?.ok ? WORDS.filter((w) => !s.held.has(w)) : null;
}

// --- releases, read from the chain ------------------------------------------------------------

const ROOT_SET = getAbiItem({ abi: wordsAbi, name: "DictionaryRootSet" });

/** The block and time the chain took `root`: its last `DictionaryRootSet`. Null when it can't be found. */
async function whenRootSet(root: string): Promise<{ block: number; at: Date } | null> {
  try {
    const client = getPublicClient();
    const logs = await getLogsAdaptive(client, { address: addressOf("words"), event: ROOT_SET, fromBlock: deployBlock() });
    const mine = logs.filter((l) => String(l.args.root).toLowerCase() === root);
    const last = mine[mine.length - 1];
    if (!last) return null;
    const block = await client.getBlock({ blockNumber: last.blockNumber });
    return { block: Number(last.blockNumber), at: new Date(Number(block.timestamp) * 1000) };
  } catch {
    return null;
  }
}

/**
 * Does this network's Words have the first-day gate? The REGISTRY's answer (`wordsGate` in
 * config/deployments*.json), never a read of the contract: Words can't change after deploy, so it
 * is a fact of the deployment, and a failed read must never pass for "no gate". Until a network's
 * Words is redeployed with it, a release opens a set to everyone at once.
 */
export function hasGate(): boolean {
  return wordsHaveGate();
}

/**
 * When the gate on a set's words lifts, read from the chain: the latest of its words'. Null: no
 * gate is set on any of them. THROWS when it can't be read: "unknown" is never "no gate".
 */
async function gateOf(words: readonly string[]): Promise<Date | null> {
  if (words.length === 0) return null;
  const res = await getPublicClient().multicall({
    allowFailure: false,
    contracts: words.map((w) => ({ address: addressOf("words"), abi: wordsAbi, functionName: "gatedUntil" as const, args: [tokenIdOf(w)] as const })),
  });
  let until = 0n;
  for (const r of res) if (BigInt(r as bigint) > until) until = BigInt(r as bigint);
  return until > 0n ? new Date(Number(until) * 1000) : null;
}

/**
 * Mark every revealed set the chain now offers as released, and say which were newly marked.
 *
 * A set counts as released when a release root was BUILT for it (`releaseRoot`) and the chain's
 * root holds none of its words back. The first half matters: a revealed set whose words were never
 * reserved on the chain is claimable too, and that is a mistake to show the operator, never a
 * release to announce. The chain's root need not BE the set's release root: a later release is
 * built on top of it, and still holds none of this set's words back.
 */
export async function reconcile(): Promise<number[]> {
  const sets = await loadSets({ fresh: true });
  const waiting = sets.sets.filter((s) => s.status === "revealed" && s.words.length > 0);
  if (waiting.length === 0) return [];
  const root = await readChainRoot({ fresh: true });
  if (!root) return [];
  const chainHeld = await heldBehind(root);
  if (!chainHeld) return [];
  const heldSet = new Set(chainHeld);
  const done: number[] = [];
  for (const s of waiting) {
    if (!s.releaseRoot || s.words.some((w) => heldSet.has(w.word))) continue;
    const when = await whenRootSet(root);
    // On a Words with the gate, the set's gate is part of what "released" records, and the game
    // tells players of it from this row. If it can't be read now, don't mark the set yet: the
    // next look tries again (a mark is made once and never corrected).
    let gateUntil: Date | null = null;
    if (hasGate()) {
      try {
        gateUntil = await gateOf(s.words.map((w) => w.word));
      } catch {
        continue;
      }
    }
    if (await markReleased(NETWORK.id, s.id, { releasedAt: when?.at ?? new Date(), gateUntil, releaseBlock: when?.block ?? null })) done.push(s.id);
  }
  if (done.length > 0) book = null;
  return done;
}

// --- the owner's root changes -----------------------------------------------------------------

export type PlanError =
  | "not_migrated"
  | "chain_unreadable"
  | "dictionary_mismatch"
  | "not_found"
  | "not_revealed"
  | "empty"
  | "not_reserved"
  | "gate_too_far"
  | "gate_rule";

const rootIntent = (root: string, note: string): TxIntent => ({
  contractKey: "words",
  contractName: "Words",
  address: isSuiteDeployed() ? addressOf("words") : null,
  signature: "setDictionaryRoot(bytes32)",
  fn: "setDictionaryRoot",
  args: [{ name: "root", type: "bytes32", value: root }],
  note,
});

/**
 * The chain's root, read now, with what this server knows of it:
 * `held` is the words it leaves out, or null for a root never built here;
 * `exact` says the tree those words give IS that root (false after a re-vendor: the dictionary
 * here has grown since the root was built).
 */
async function chainNow(): Promise<{ root: string; held: Set<string> | null; exact: boolean } | { error: PlanError }> {
  const root = await readChainRoot({ fresh: true });
  if (!root) return { error: "chain_unreadable" };
  const held = await heldBehind(root);
  if (!held) return { root, held: null, exact: false };
  return { root, held: new Set(held), exact: treeWithout(held).root.toLowerCase() === root };
}

/** Which of `words` are claimed on the chain right now. Null when it can't be read. */
export async function claimedAmong(words: readonly string[]): Promise<string[] | null> {
  if (words.length === 0) return [];
  if (!isSuiteDeployed()) return null;
  try {
    const res = await getPublicClient().multicall({
      allowFailure: false,
      contracts: words.map((w) => ({ address: addressOf("words"), abi: wordsAbi, functionName: "exists" as const, args: [tokenIdOf(w)] as const })),
    });
    return words.filter((_, i) => res[i] === true);
  } catch {
    return null;
  }
}

export interface ReservePlan {
  ok: true;
  /** The chain already holds back exactly what the sets say. */
  upToDate: boolean;
  currentRoot: string;
  root: string;
  /** How many words the new root holds back in all. */
  holds: number;
  /**
   * Does this server know what the chain's CURRENT root holds back? False for a root never built
   * here: the new root is still right (it is built from the sets alone), but what it changes
   * can't be listed, so `removed` and `added` are empty.
   */
  chainKnown: boolean;
  /** The chain's root is one built here from an older dictionary (a re-vendor): this root also adds the new words. */
  dictionaryChanged: boolean;
  /** Newly held back by this root. */
  removed: string[];
  /** Let go by this root: held back on the chain, in no unreleased set any more. */
  added: string[];
  /**
   * Held-back words somebody owns now (among the newly held back; among all of them when the
   * chain's root isn't known). They stay theirs; the root only stops a re-claim. Null: couldn't be read.
   */
  alreadyClaimed: string[] | null;
  intents: TxIntent[];
}

/**
 * RESERVE: the root that makes the chain hold back what the sets hold back. It removes words (ones
 * newly put in a set) and may add some back (ones taken out of every set). The row for the new root
 * is stored before the plan is returned.
 *
 * It is built from the sets and the bundled dictionary alone, so it is also the way OUT of a root
 * this server can't serve: one never built here, or one built before a re-vendor. (After a
 * re-vendor, send this root, never `derive:contracts`'s: that one holds nothing back.)
 */
export async function planReserve(): Promise<ReservePlan | { ok: false; error: PlanError }> {
  await reconcile().catch(() => []); // never hold back again a set the chain has already released
  const sets = await loadSets({ fresh: true });
  if (!sets.known || !sets.migrated) return { ok: false, error: "not_migrated" };
  const chain = await chainNow();
  if ("error" in chain) return { ok: false, error: chain.error };
  const change = reserveChange(chain.held ?? new Set(), heldOf(sets.sets));
  const tree = treeWithout(change.held);
  const root = tree.root.toLowerCase();
  await saveRoot(NETWORK.id, root, change.held, "reserve");
  heldByRoot.set(root, change.held);
  const chainKnown = chain.held !== null;
  const removed = chainKnown ? change.removed : [];
  const added = chainKnown ? change.added : [];
  const note = chainKnown
    ? `Reserve: hold back ${removed.length} more, let go ${added.length}${chain.exact ? "" : ", and take in the dictionary's new words"}.`
    : `Reserve: hold back ${change.held.length} words in all.`;
  return {
    ok: true,
    upToDate: root === chain.root,
    currentRoot: chain.root,
    root,
    holds: change.held.length,
    chainKnown,
    dictionaryChanged: chainKnown && !chain.exact,
    removed,
    added,
    alreadyClaimed: await claimedAmong(chainKnown ? change.removed : change.held),
    intents: root === chain.root ? [] : [rootIntent(root, note)],
  };
}

export interface ReleasePlan {
  ok: true;
  setId: number;
  currentRoot: string;
  root: string;
  /** The words this root adds: every word of the set. Never any removed (see `releaseChange`). */
  added: string[];
  /**
   * The first-day gate this plan sets, or null with the reason. `owned` is the set's words a player
   * already holds: they are left out of the gate (Words.setGate refuses a claimed word, and one
   * would revert the whole release), so if one is dissolved during the first day it opens ungated.
   */
  gate: { until: number; tokenIds: string[]; owned: string[] } | null;
  gateNote: string | null;
  /** In the order they must land: the gate FIRST, then the root. */
  intents: TxIntent[];
}

/**
 * RELEASE one revealed set, every word of which the chain holds back: a root that adds exactly its
 * words to the tree the chain holds, and,
 * where this network's Words has the gate, the gate on those words FIRST. In that order there is no
 * moment when a set word is claimable without the gate, whether the two calls go in one batch or
 * one after the other.
 */
export async function planRelease(setId: number, nowSec = Math.floor(Date.now() / 1000)): Promise<ReleasePlan | { ok: false; error: PlanError; detail?: string }> {
  await reconcile().catch(() => []);
  const sets = await loadSets({ fresh: true });
  if (!sets.known || !sets.migrated) return { ok: false, error: "not_migrated" };
  const set = sets.sets.find((s) => s.id === setId);
  if (!set) return { ok: false, error: "not_found" };
  if (set.status !== "revealed") return { ok: false, error: "not_revealed" };
  if (set.words.length === 0) return { ok: false, error: "empty" };
  const chain = await chainNow();
  if ("error" in chain) return { ok: false, error: chain.error };
  // A release is "the chain's tree, plus this set's words", so the chain's tree must be one this
  // server can rebuild exactly. Otherwise it can't promise that nothing is removed (a root never
  // built here), or it would slip the dictionary's new words in beside the set's (after a re-vendor).
  if (!chain.held || !chain.exact) {
    return { ok: false, error: "dictionary_mismatch", detail: "the chain’s root can’t be rebuilt from the dictionary here: send the reserve root first" };
  }
  const words = set.words.map((w) => w.word);
  const change = releaseChange(chain.held, words);
  // Every word of the set must be held back on the chain first. Otherwise the "release" would be a
  // root that changes nothing (or less than the set), the set would be marked released with no
  // transaction behind it, and its gate would come after its words were already claimable.
  if (change.neverHeld.length > 0) {
    return {
      ok: false,
      error: "not_reserved",
      detail: `${change.neverHeld.length} of this set’s ${words.length} words are not held back on the chain: send the reserve root first`,
    };
  }
  const tree = treeWithout(change.held);
  const root = tree.root.toLowerCase();

  const intents: TxIntent[] = [];
  let gatePlan: ReleasePlan["gate"] = null;
  let gateNote: string | null = null;
  if (set.gateHours <= 0) gateNote = "This set has no first-day gate: it opens to everyone at once.";
  else if (!hasGate()) gateNote = "This network’s Words has no gate yet (it arrives with the next redeploy): the set opens to everyone at once.";
  else {
    // The registry says this Words has the gate. Ask the contract too before planning a call to
    // it: a registry that is wrong, or a chain that can't be read, gets no plan at all, never a
    // release without its gate.
    try {
      await getPublicClient().readContract({ address: addressOf("words"), abi: wordsAbi, functionName: "claimSigner" });
    } catch {
      return { ok: false, error: "chain_unreadable", detail: "couldn’t read the gate on this network’s Words (Words.claimSigner)" };
    }
    const g = gateUntilFor(nowSec, set);
    if ("error" in g) return { ok: false, error: "gate_too_far", detail: g.error };
    // A first day needs a rule that can be checked: a token rule with no contract, or an allowlist
    // with nobody on it, would lock the set's words to everyone for the whole gate.
    const rule = releaseProblems(set);
    if (rule.length > 0) return { ok: false, error: "gate_rule", detail: rule.join("; ") };
    // And a token rule's contract must answer on Base: a mistyped address fails every balance
    // read, which is "try again" for every player all day, and the rule is final once released.
    if (set.gateRule === "token" && set.gateToken && !(await tokenReadable(set.gateToken))) {
      return { ok: false, error: "gate_rule", detail: "couldn’t read balanceOf on the token’s contract on Base: check the address, then build the release again" };
    }
    // Words.setGate reverts on a word somebody holds, and the release with it: gate the rest. If
    // ownership can't be read, no plan: a batch that might revert is worse than waiting a minute.
    const owned = g.until !== null ? await claimedAmong(words) : [];
    if (owned === null) return { ok: false, error: "chain_unreadable", detail: "couldn’t read which of the set’s words are already owned" };
    const gated = words.filter((w) => !owned.includes(w));
    if (g.until !== null && gated.length === 0) gateNote = "Every word of this set is already owned: there is nothing to gate.";
    if (g.until !== null && gated.length > 0) {
      const tokenIds = gated.map((w) => tokenIdOf(w).toString());
      gatePlan = { until: g.until, tokenIds, owned };
      intents.push({
        contractKey: "words",
        contractName: "Words",
        address: addressOf("words"),
        signature: "setGate(uint256[],uint64)",
        fn: "setGate",
        args: [
          { name: "tokenIds", type: "uint256[]", value: `[${tokenIds.join(",")}]` },
          { name: "until", type: "uint64", value: String(g.until) },
        ],
        note: `FIRST: the first-day gate on “${set.name}” (${gated.length} words${owned.length ? `; ${owned.length} already owned are left out` : ""}) until ${new Date(g.until * 1000).toISOString()}.`,
      });
    }
  }
  intents.push(rootIntent(root, `${gatePlan ? "THEN: r" : "R"}elease “${set.name}”: the root adds ${change.added.length} words and removes none.`));

  // The root's words first (the chain's root must always turn back into its tree), then the mark
  // on the set that a release was built for it: that mark is what lets `reconcile` call it released.
  await saveRoot(NETWORK.id, root, change.held, `release:${set.id}`);
  heldByRoot.set(root, change.held);
  if (!(await setReleaseRoot(NETWORK.id, set.id, root))) return { ok: false, error: "not_revealed" };
  book = null;
  return { ok: true, setId: set.id, currentRoot: chain.root, root, added: change.added, gate: gatePlan, gateNote, intents };
}

/** Is `word` a dictionary word the game is holding back right now? (For a plain "not available yet".) */
export async function isHeldBack(word: string): Promise<boolean | null> {
  const w = word.trim().toUpperCase();
  if (!isWord(w)) return false;
  const s = await serving().catch(() => null);
  return s?.ok ? s.held.has(w) : null;
}
