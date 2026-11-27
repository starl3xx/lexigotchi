/**
 * /api/admin/sets: reserved word sets for the operator console (decisions.md, "Reserved word sets").
 *
 * GATED on the server like Players and System (lib/admin/serverAuth.ts), and never cached: this is
 * the one route that returns a draft set's name and words. A set's contents reach a player's
 * browser only through `publicSets` (lib/sets/rules.ts), never from here.
 *
 * Nothing here logs a word: a refusal carries a code, and a driver's error (whose text holds the
 * statement's parameters, which are the words) is reduced to its code before it is logged.
 */
import { NextResponse } from "next/server";
import { checkAdmin, refusalBody } from "@/lib/admin/serverAuth";
import { isMissingTable } from "@/lib/db/profiles";
import { WORDS, isWord } from "@/lib/dictionary";
import { dictionaryRoot } from "@/lib/onchain/dictionaryTree";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { readClaimsBetween } from "@/lib/onchain/claims";
import {
  SetError,
  addWords,
  clearStamp,
  createSet,
  deleteSet,
  moveWords,
  readStamps,
  removeWords,
  reorderSets,
  replaceAllowlist,
  replaceDrafts,
  revealSet,
  setHeadliner,
  setStamp,
  updateSet,
} from "@/lib/db/sets";
import {
  SETTINGS_DEFAULTS,
  STAMP_MAX_BYTES,
  checkSettings,
  checkWords,
  cleanWord,
  commitmentOf,
  exportSets,
  heldOf,
  parseAllowlist,
  parseSetsFile,
  releaseProblems,
  reserveChange,
  revealProblems,
  scheduleError,
  setOfWord,
  sniffStamp,
  type GateRule,
  type SetType,
  type WordSet,
} from "@/lib/sets/rules";
import { TEST_COLLAB, pickTestWords, placeholderStamp } from "@/lib/sets/testCollab";
import { wordTier } from "@/lib/economy";
import { claimedAmong, forgetSets, hasGate, loadSets, planRelease, planReserve, reconcile, serving } from "@/lib/sets/server";
import { setStats, type SetClaim, type SetStats } from "@/lib/sets/stats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

const codeOf = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string }; name?: string } | null;
  return String(e?.code ?? e?.cause?.code ?? e?.name ?? "error").slice(0, 40);
};

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export interface AdminSet {
  id: number;
  name: string;
  status: WordSet["status"];
  revealAt: string | null;
  releaseAt: string | null;
  gateHours: number;
  perPlayerLimit: number;
  sort: number;
  revealedAt: string | null;
  releasedAt: string | null;
  gateUntil: string | null;
  words: { word: string; headliner: boolean }[];
  /** "standard", or "collab": a set made with a partner. */
  type: SetType;
  partnerName: string | null;
  partnerUrl: string | null;
  colorA: string | null;
  colorB: string | null;
  /** The stamp as a `data:` address for the preview (a draft's stamp has no public address), or null. */
  stamp: string | null;
  gateRule: GateRule;
  gateToken: string | null;
  gateMin: string | null;
  gateLabel: string | null;
  /** How many wallets are on the allowlist. The wallets are never sent back. */
  allowlistCount: number;
  /** A draft: what it still needs before it can be revealed. Revealed: before its release can be built. */
  needs: string[];
  /** Words of this (unreleased) set somebody owns on the chain now. Null: couldn't be read. */
  claimed: string[] | null;
  /** Words of this (unreleased) set the chain's root does NOT hold back: claimable right now. */
  open: string[];
  stats: SetStats | null;
}

export interface AdminSetsPayload {
  ok: true;
  migrated: boolean;
  /** False: migration 0023 hasn't run, so nothing of a collab set can be saved yet. */
  collab: boolean;
  /** True on a test network: the placeholder "Test collab" can be made here, and only here. */
  testnet: boolean;
  network: string;
  chain: {
    deployed: boolean;
    /** The chain's root, or null when it couldn't be read. */
    root: string | null;
    fullRoot: string;
    /** False: the chain holds a root this server never built (or the sets couldn't be read). */
    known: boolean;
    /** How many words the chain's root leaves out. */
    held: number;
    /** Does this network's Words have the first-day gate? */
    gate: boolean;
  };
  /** The sets against the chain: words a Reserve root would newly hold back, and let go. */
  pending: { removed: number; added: number } | null;
  sets: AdminSet[];
  /** keccak256 of the canonical JSON of every unreleased set. */
  commitment: string;
  /** The export: every unreleased set, as the file an import takes back. */
  file: ReturnType<typeof exportSets>;
}

export async function GET(req: Request) {
  const who = await checkAdmin(req);
  if (!who.ok) return json(refusalBody(who), who.status);
  try {
    await reconcile().catch(() => []);
    // The sets are read for themselves. What the chain holds is a separate question, and when it
    // can't be answered (a root this server never built) the operator still needs the sets, the
    // export, and the commitment in front of them.
    const [book, s] = await Promise.all([loadSets({ fresh: true }), serving()]);
    if (!book.known) return json({ ok: false, error: "try_again" }, 503);
    const sets = book.sets;
    const stamps = sets.some((x) => x.stampAt) ? await readStamps(NETWORK.id) : new Map<number, string>();
    const unreleased = sets.filter((x) => x.status !== "released");
    const released = sets.filter((x) => x.status === "released");
    const allWords = sets.flatMap((x) => x.words.map((w) => w.word));
    const owned = await claimedAmong(allWords);
    const ownedSet = owned ? new Set(owned) : null;

    // One read of the claims since the earliest release serves every released set.
    let claims: SetClaim[] | null = null;
    const firstRelease = Math.min(...released.map((x) => (x.releasedAt ? x.releasedAt.getTime() : Infinity)));
    if (released.length > 0 && Number.isFinite(firstRelease) && isSuiteDeployed()) {
      try {
        claims = (await readClaimsBetween(Math.floor(firstRelease / 1000))).map((c) => ({ word: c.word.toUpperCase(), owner: c.owner, at: c.at }));
      } catch {
        claims = null; // unread is never shown as "no claims"
      }
    }

    const body: AdminSetsPayload = {
      ok: true,
      migrated: book.migrated,
      collab: book.collab,
      testnet: NETWORK.isTestnet,
      network: NETWORK.name,
      chain: {
        deployed: isSuiteDeployed(),
        root: s.ok ? s.chainRoot : null,
        fullRoot: dictionaryRoot(),
        known: s.ok,
        held: s.ok ? s.chainHeld.size : 0,
        gate: hasGate(),
      },
      pending: s.ok
        ? (() => {
            const c = reserveChange(s.chainHeld, heldOf(sets));
            return { removed: c.removed.length, added: c.added.length };
          })()
        : null,
      sets: sets.map((x) => {
        const words = x.words.map((w) => w.word);
        const isOut = x.status !== "released";
        return {
          id: x.id,
          name: x.name,
          status: x.status,
          revealAt: iso(x.revealAt),
          releaseAt: iso(x.releaseAt),
          gateHours: x.gateHours,
          perPlayerLimit: x.perPlayerLimit,
          sort: x.sort,
          revealedAt: iso(x.revealedAt),
          releasedAt: iso(x.releasedAt),
          gateUntil: iso(x.gateUntil),
          words: x.words,
          type: x.type,
          partnerName: x.partnerName,
          partnerUrl: x.partnerUrl,
          colorA: x.colorA,
          colorB: x.colorB,
          stamp: stamps.get(x.id) ?? null,
          gateRule: x.gateRule,
          gateToken: x.gateToken,
          gateMin: x.gateMin,
          gateLabel: x.gateLabel,
          allowlistCount: x.allowlistCount,
          needs: x.status === "draft" ? (x.words.length ? revealProblems(x) : []) : x.status === "revealed" ? releaseProblems(x) : [],
          claimed: isOut ? (ownedSet ? words.filter((w) => ownedSet.has(w)) : null) : null,
          open: isOut && s.ok && s.chainRoot ? words.filter((w) => !s.chainHeld.has(w)) : [],
          stats:
            x.status === "released" && x.releasedAt && claims
              ? setStats(
                  { words, releasedAtSec: Math.floor(x.releasedAt.getTime() / 1000), gateUntilSec: x.gateUntil ? Math.floor(x.gateUntil.getTime() / 1000) : null },
                  claims,
                  owned,
                )
              : null,
        };
      }),
      commitment: commitmentOf(unreleased),
      file: exportSets(sets),
    };
    return json(body);
  } catch (err) {
    console.error("[admin/sets] read failed:", codeOf(err));
    return json({ ok: false, error: "failed" }, 500);
  }
}

const idOf = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) && v > 0 ? v : null);
const wordsOf = (v: unknown): unknown[] => (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[\s,;]+/).filter(Boolean) : []);

export async function POST(req: Request) {
  const who = await checkAdmin(req);
  if (!who.ok) return json(refusalBody(who), who.status);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const action = typeof body?.action === "string" ? body.action : "";
  if (!body || !action) return json({ ok: false, error: "bad_request" }, 400);
  const chainId = NETWORK.id;

  try {
    switch (action) {
      case "create": {
        const c = checkSettings({ ...body, name: body.name ?? "" });
        if (!c.ok) return json({ ok: false, error: "invalid", errors: c.errors }, 400);
        const sched = scheduleError({ revealAt: c.value.revealAt ?? null, releaseAt: c.value.releaseAt ?? null });
        if (sched) return json({ ok: false, error: "invalid", errors: [sched] }, 400);
        const id = await createSet(chainId, { ...SETTINGS_DEFAULTS, ...c.value, name: c.value.name ?? "", sort: c.value.sort ?? 0 });
        forgetSets();
        return json({ ok: true, id });
      }
      case "update": {
        const id = idOf(body.id);
        if (!id) return json({ ok: false, error: "bad_request" }, 400);
        const c = checkSettings(body);
        if (!c.ok) return json({ ok: false, error: "invalid", errors: c.errors }, 400);
        // The dates are checked together with the ones the set already has.
        const book = await loadSets({ fresh: true });
        if (!book.known) return json({ ok: false, error: "try_again" }, 503);
        const cur = book.sets.find((x) => x.id === id);
        if (!cur) return json({ ok: false, error: "not_found" }, 404);
        const sched = scheduleError({
          revealAt: c.value.revealAt !== undefined ? c.value.revealAt : cur.revealAt,
          releaseAt: c.value.releaseAt !== undefined ? c.value.releaseAt : cur.releaseAt,
        });
        if (sched) return json({ ok: false, error: "invalid", errors: [sched] }, 400);
        await updateSet(chainId, id, c.value);
        forgetSets();
        return json({ ok: true });
      }
      case "delete": {
        const id = idOf(body.id);
        if (!id) return json({ ok: false, error: "bad_request" }, 400);
        await deleteSet(chainId, id);
        forgetSets();
        return json({ ok: true });
      }
      case "addWords": {
        const id = idOf(body.id);
        if (!id) return json({ ok: false, error: "bad_request" }, 400);
        // The table's key is what stops a word joining two sets; this check only names the reason.
        const check = checkWords(wordsOf(body.words), isWord, new Set());
        const res = await addWords(chainId, id, check.ok);
        forgetSets();
        return json({ ok: true, added: res.added, taken: res.taken, malformed: check.malformed, unknown: check.unknown });
      }
      case "removeWords": {
        const id = idOf(body.id);
        if (!id) return json({ ok: false, error: "bad_request" }, 400);
        const words = wordsOf(body.words).map(cleanWord).filter((w): w is string => w !== null);
        const removed = await removeWords(chainId, id, words);
        forgetSets();
        return json({ ok: true, removed });
      }
      case "moveWords": {
        const to = idOf(body.to);
        if (!to) return json({ ok: false, error: "bad_request" }, 400);
        const words = wordsOf(body.words).map(cleanWord).filter((w): w is string => w !== null);
        const moved = await moveWords(chainId, words, to);
        forgetSets();
        return json({ ok: true, moved });
      }
      case "headliner": {
        const id = idOf(body.id);
        const word = cleanWord(body.word);
        if (!id || !word) return json({ ok: false, error: "bad_request" }, 400);
        await setHeadliner(chainId, id, word, body.on === true);
        forgetSets();
        return json({ ok: true });
      }
      case "reorder": {
        const ids = Array.isArray(body.ids) ? body.ids.map(idOf).filter((n): n is number => n !== null) : [];
        if (ids.length === 0) return json({ ok: false, error: "bad_request" }, 400);
        await reorderSets(chainId, ids);
        forgetSets();
        return json({ ok: true });
      }
      case "import": {
        if (typeof body.text !== "string" || body.text.length > 400_000) return json({ ok: false, error: "bad_request" }, 400);
        const book = await loadSets({ fresh: true });
        if (!book.known) return json({ ok: false, error: "try_again" }, 503);
        if (!book.migrated) return json({ ok: false, error: "not_migrated" }, 409);
        // An import only makes drafts: a word a revealed or released set holds can't be taken.
        const locked = new Set(setOfWord(book.sets.filter((x) => x.status !== "draft")).keys());
        const parsed = parseSetsFile(body.text, isWord, locked);
        if (!parsed.ok) return json({ ok: false, error: "invalid", errors: parsed.errors }, 400);
        const ids = await replaceDrafts(chainId, parsed.sets);
        forgetSets();
        return json({ ok: true, sets: ids.length, words: parsed.sets.reduce((n, x) => n + x.words.length, 0) });
      }
      case "reveal": {
        const id = idOf(body.id);
        if (!id) return json({ ok: false, error: "bad_request" }, 400);
        await revealSet(chainId, id, new Date());
        forgetSets();
        return json({ ok: true });
      }
      case "stamp": {
        // A collab's stamp: a small raster picture, sent as base64. What it IS comes from its own
        // first bytes, never from a name or a type the browser sent, and an SVG is never taken (it
        // can carry script, and this picture is drawn into every card of the set).
        const id = idOf(body.id);
        if (!id || typeof body.data !== "string" || body.data.length > Math.ceil(STAMP_MAX_BYTES / 3) * 4 + 4) {
          return json({ ok: false, error: "invalid", errors: [`a stamp is a PNG or a JPEG of at most ${Math.round(STAMP_MAX_BYTES / 1024)} KB`] }, 400);
        }
        const bytes = Buffer.from(body.data, "base64");
        const mime = sniffStamp(bytes);
        if (!mime || bytes.length === 0 || bytes.length > STAMP_MAX_BYTES) {
          return json({ ok: false, error: "invalid", errors: [`a stamp is a PNG or a JPEG of at most ${Math.round(STAMP_MAX_BYTES / 1024)} KB`] }, 400);
        }
        await setStamp(chainId, id, { mime, base64: bytes.toString("base64"), bytes: bytes.length });
        forgetSets();
        return json({ ok: true, bytes: bytes.length, mime });
      }
      case "clearStamp": {
        const id = idOf(body.id);
        if (!id) return json({ ok: false, error: "bad_request" }, 400);
        await clearStamp(chainId, id);
        forgetSets();
        return json({ ok: true });
      }
      case "allowlist": {
        // The wallets a set's first day is open to, pasted whole: the new list takes the old one's place.
        const id = idOf(body.id);
        if (!id || typeof body.text !== "string" || body.text.length > 2_000_000) return json({ ok: false, error: "bad_request" }, 400);
        const parsed = parseAllowlist(body.text);
        if (!parsed.ok) return json({ ok: false, error: "invalid", errors: [parsed.error] }, 400);
        const wallets = await replaceAllowlist(chainId, id, parsed.wallets);
        forgetSets();
        return json({ ok: true, wallets, bad: parsed.bad });
      }
      case "testCollab": {
        // The placeholder collab set, for a test network only (lib/sets/testCollab.ts). It is made
        // as a DRAFT: the operator reveals, reserves, and releases it like any set.
        if (!NETWORK.isTestnet) return json({ ok: false, error: "not_testnet" }, 409);
        const book = await loadSets({ fresh: true });
        if (!book.known) return json({ ok: false, error: "try_again" }, 503);
        if (!book.migrated || !book.collab) return json({ ok: false, error: "not_migrated" }, 409);
        if (book.sets.some((x) => x.name === TEST_COLLAB.name)) return json({ ok: false, error: "exists" }, 409);
        // Words in no set, that the chain doesn't hold back, and that nobody owns: a reserved word
        // must still be unclaimed. A sample is asked about, never the whole dictionary.
        const s = await serving();
        if (!s.ok) return json({ ok: false, error: "try_again" }, 503);
        const inSet = setOfWord(book.sets);
        const free = WORDS.filter((w) => !inSet.has(w) && !s.chainHeld.has(w));
        const sample = [...free.filter((w) => wordTier(w) === "Mythic").slice(0, 40), ...free.filter((w) => wordTier(w) !== "Mythic" && wordTier(w) !== "Legendary").sort(() => Math.random() - 0.5).slice(0, 80)];
        const owned = await claimedAmong(sample);
        if (owned === null) return json({ ok: false, error: "try_again" }, 503);
        const words = pickTestWords(sample.filter((w) => !owned.includes(w)), wordTier);
        if (!words) return json({ ok: false, error: "no_words" }, 409);
        const id = await createSet(chainId, {
          ...SETTINGS_DEFAULTS,
          name: TEST_COLLAB.name,
          sort: book.sets.reduce((n, x) => Math.max(n, x.sort + 1), 0),
          type: "collab",
          partnerName: TEST_COLLAB.partnerName,
          colorA: TEST_COLLAB.colorA,
          colorB: TEST_COLLAB.colorB,
        });
        await addWords(chainId, id, words);
        const png = Buffer.from(placeholderStamp());
        await setStamp(chainId, id, { mime: "image/png", base64: png.toString("base64"), bytes: png.length });
        forgetSets();
        return json({ ok: true, id });
      }
      case "planReserve": {
        const plan = await planReserve();
        return json(plan, plan.ok ? 200 : 409);
      }
      case "planRelease": {
        const id = idOf(body.id);
        if (!id) return json({ ok: false, error: "bad_request" }, 400);
        const plan = await planRelease(id);
        return json(plan, plan.ok ? 200 : 409);
      }
      case "confirm": {
        forgetSets();
        return json({ ok: true, released: await reconcile() });
      }
      default:
        return json({ ok: false, error: "bad_request" }, 400);
    }
  } catch (err) {
    if (err instanceof SetError) {
      return json({ ok: false, error: err.code, words: err.words, ...(err.problems.length ? { errors: err.problems } : {}) }, err.code === "not_found" ? 404 : 409);
    }
    // The set tables aren't there (migration 0021 hasn't run): say that, for every action.
    if (isMissingTable(err)) return json({ ok: false, error: "not_migrated" }, 409);
    console.error(`[admin/sets] ${action} failed:`, codeOf(err));
    return json({ ok: false, error: "failed" }, 500);
  }
}
