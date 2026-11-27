/**
 * Reserved word sets: the rules (decisions.md, "Reserved word sets"). Pure: no database, no chain.
 *
 * A SET is a themed group of dictionary words held back from the game and released later. A word is
 * reserved by being left OUT of the Merkle root `Words.claim` checks (`Words.dictionaryRoot`), and a
 * set is released by publishing a root that includes its words. Everything about a set is data until
 * then: a DRAFT set is fully editable, a REVEALED set's name and words are locked (players have seen
 * them), and a RELEASED set is permanent.
 *
 * What is private, and what can't be. The full dictionary is public (this repository, and the app's
 * own bundle), and the game says "not available yet" about a held-back word, so WHICH words are held
 * back can be worked out by anyone who asks about each word. A set's name, which words it groups,
 * its headliners, and its dates are in no public place until the set is revealed: `publicSets` is
 * the one function that decides what a player's browser is told, and it gives a draft set as a
 * locked slot with nothing in it.
 */
import { keccak256, stringToBytes } from "viem";

export type SetStatus = "draft" | "revealed" | "released";

/**
 * A COLLAB set is one made with a partner (decisions.md, "Collab sets"): exactly five words, a
 * partner's name and link, and a card look of its own (two colors and a stamp). Collab changes how
 * the card looks and makes the word Legendary; the word itself is the same word.
 */
export type SetType = "standard" | "collab";

/**
 * Who a set's first day is open to. A player must be verified in every case.
 * - `verified`: every verified player (the default).
 * - `allowlist`: only a player with a wallet on the list the operator imported.
 * - `token`: only a player holding at least `gateMin` of the contract `gateToken` on Base.
 */
export type GateRule = "verified" | "allowlist" | "token";

export const SET_TYPES: readonly SetType[] = ["standard", "collab"];
export const GATE_RULES: readonly GateRule[] = ["verified", "allowlist", "token"];
/** A collab set has exactly this many words. */
export const COLLAB_WORDS = 5;
export const PARTNER_URL_MAX = 200;
/** A list the operator pastes is bounded. */
export const ALLOWLIST_MAX = 20_000;
/** A stamp is a small raster picture: PNG, JPEG, or WebP, never SVG (an SVG can carry script). */
export const STAMP_MAX_BYTES = 256 * 1024;
export const STAMP_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type StampType = (typeof STAMP_TYPES)[number];

export interface SetWord {
  word: string;
  headliner: boolean;
}

export interface WordSet {
  id: number;
  name: string;
  status: SetStatus;
  /** When the set shows its name and words. Null: only when the operator reveals it by hand. */
  revealAt: Date | null;
  /** The planned release. The release itself is the owner's transaction, never a clock. */
  releaseAt: Date | null;
  /** The first-day gate's length, in hours (0 = no gate). */
  gateHours: number;
  /** Words of this set one player may claim while the gate is up. */
  perPlayerLimit: number;
  sort: number;
  revealedAt: Date | null;
  releasedAt: Date | null;
  /** When the gate lifts, read from the chain at release. Null: no gate was set. */
  gateUntil: Date | null;
  /** The block the chain was first seen holding the set's words (the stats read from here). */
  releaseBlock: number | null;
  /** The root last built to release this set, or null when none was (see `word_sets.release_root`). */
  releaseRoot: string | null;
  words: SetWord[];
  type: SetType;
  /** A collab's partner: its name, and a link to it (https). Null on a standard set, or not set yet. */
  partnerName: string | null;
  partnerUrl: string | null;
  /** A collab's two card colors, "#rrggbb". */
  colorA: string | null;
  colorB: string | null;
  /** When its stamp image was last stored, or null when it has none (the image itself is its own read). */
  stampAt: Date | null;
  gateRule: GateRule;
  /** For the `token` rule: the contract on Base, and the least a player must hold (a whole number of the token's smallest unit). */
  gateToken: string | null;
  gateMin: string | null;
  /** Who an allowlist or a token rule lets in, in the operator's words for players ("holders of …"). Null: the plain wording. */
  gateLabel: string | null;
  /** How many wallets are on its allowlist (the wallets themselves never leave the server). */
  allowlistCount: number;
}

/** A standard set's values for the fields a collab adds: what every older row and test set has. */
export const STANDARD_FIELDS = {
  type: "standard",
  partnerName: null,
  partnerUrl: null,
  colorA: null,
  colorB: null,
  stampAt: null,
  gateRule: "verified",
  gateToken: null,
  gateMin: null,
  gateLabel: null,
  allowlistCount: 0,
} as const satisfies Pick<WordSet, "type" | "partnerName" | "partnerUrl" | "colorA" | "colorB" | "stampAt" | "gateRule" | "gateToken" | "gateMin" | "gateLabel" | "allowlistCount">;

export const GATE_HOURS_DEFAULT = 24;
/** The contract refuses a gate further ahead than this (Words.MAX_GATE), so a longer one can't be built. */
export const GATE_HOURS_MAX = 7 * 24;
export const PER_PLAYER_DEFAULT = 1;
export const PER_PLAYER_MAX = 100;
export const NAME_MAX = 60;
/** A paste is bounded: the whole dictionary is under 5,000 words. */
export const IMPORT_MAX_SETS = 200;

/** A word as the dictionary writes it (UPPERCASE, five letters), or null. */
export function cleanWord(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const w = raw.trim().toUpperCase();
  return /^[A-Z]{5}$/.test(w) ? w : null;
}

/**
 * What may still change on a set in each state. `name` covers everything a player reads as the
 * set's identity once it is revealed: its name, and for a collab its kind, partner, colors, and
 * stamp. `schedule` covers the dates and everything about the first day, the gate rule and its
 * allowlist included (a partner's list arrives when it arrives).
 */
export function editable(status: SetStatus): { words: boolean; name: boolean; schedule: boolean; remove: boolean } {
  if (status === "draft") return { words: true, name: true, schedule: true, remove: true };
  // Revealed: players have read the name and the words, so those stay. The dates and the gate's
  // settings can still move (a release that slips a day must not need a new set).
  if (status === "revealed") return { words: false, name: false, schedule: true, remove: false };
  return { words: false, name: false, schedule: false, remove: false };
}

/** "#rrggbb", lowercase, or null. */
export function cleanColor(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const c = raw.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : null;
}

/** An https link, or null. Nothing else is ever shown as a partner's link. */
export function cleanUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const u = raw.trim();
  if (u.length === 0 || u.length > PARTNER_URL_MAX) return null;
  try {
    const parsed = new URL(u);
    return parsed.protocol === "https:" && parsed.hostname.includes(".") ? parsed.toString() : null;
  } catch {
    return null;
  }
}

/** A wallet address, lowercase, or null. */
export function cleanWallet(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const a = raw.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(a) ? a : null;
}

/**
 * Why a set can't be revealed yet, in the operator's words ([] = it can). A reveal is the moment a
 * set's identity is locked and shown, so everything a player will read must be there: a collab
 * needs exactly five words, its partner's name, its two colors, and its stamp. (The first day's
 * rule isn't identity: it can change until the release, and `releaseProblems` checks it there.)
 */
export function revealProblems(s: Pick<WordSet, "type" | "words" | "partnerName" | "colorA" | "colorB" | "stampAt">): string[] {
  const out: string[] = [];
  if (s.words.length === 0) out.push("a set with no words can't be revealed");
  if (s.type === "collab") {
    if (s.words.length !== COLLAB_WORDS) out.push(`a collab set has exactly ${COLLAB_WORDS} words (this one has ${s.words.length})`);
    if (!s.partnerName?.trim()) out.push("a collab set needs its partner's name");
    if (!s.colorA || !s.colorB) out.push("a collab set needs its two colors");
    if (!s.stampAt) out.push("a collab set needs its stamp");
  }
  return out;
}

/**
 * Why a set's release can't be built yet ([] = it can): its first day needs a rule that can be
 * checked. A set with no first day (gateHours 0) has no rule to check.
 */
export function releaseProblems(s: Pick<WordSet, "gateHours" | "gateRule" | "gateToken" | "gateMin" | "allowlistCount">): string[] {
  if (s.gateHours <= 0) return [];
  if (s.gateRule === "token" && (!s.gateToken || !s.gateMin)) return ["the token rule needs a contract and a minimum balance"];
  if (s.gateRule === "allowlist" && s.allowlistCount === 0) return ["the allowlist rule needs at least one wallet on the list"];
  return [];
}

/** A whole number of a token's smallest unit, as digits ("1", "1000000000000000000"), above zero; or null. */
export function cleanAmount(raw: unknown): string | null {
  const t = typeof raw === "number" && Number.isSafeInteger(raw) ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (!/^\d{1,60}$/.test(t)) return null;
  const n = t.replace(/^0+/, "");
  return n.length ? n : null;
}

/**
 * Read a pasted allowlist: wallets separated by anything (lines, commas, spaces). Each wallet once,
 * lowercase. Anything that isn't a wallet is counted, never echoed (a paste may hold other things).
 */
export function parseAllowlist(text: string): { ok: true; wallets: string[]; bad: number } | { ok: false; error: string } {
  const parts = text.split(/[\s,;]+/).filter(Boolean);
  const seen = new Set<string>();
  let bad = 0;
  for (const part of parts) {
    const w = cleanWallet(part);
    if (w) seen.add(w);
    else bad++;
  }
  if (seen.size > ALLOWLIST_MAX) return { ok: false, error: `at most ${ALLOWLIST_MAX.toLocaleString("en-US")} wallets on one list` };
  return { ok: true, wallets: [...seen], bad };
}

/** What a picture's first bytes say it is: PNG, JPEG, or WebP; or null (an SVG, a GIF, anything else). */
export function sniffStamp(bytes: Uint8Array): StampType | null {
  const at = (i: number, ...v: number[]) => v.every((x, j) => bytes[i + j] === x);
  if (bytes.length >= 8 && at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (bytes.length >= 3 && at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (bytes.length >= 12 && at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  return null;
}

/** Every word in a set that isn't released yet: the words the game holds back. */
export function heldOf(sets: readonly Pick<WordSet, "status" | "words">[]): Set<string> {
  const held = new Set<string>();
  for (const s of sets) if (s.status !== "released") for (const w of s.words) held.add(w.word);
  return held;
}

/** word → the set that has it. A word is in one set at most (the table's key holds that too). */
export function setOfWord(sets: readonly Pick<WordSet, "id" | "words">[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const s of sets) for (const w of s.words) m.set(w.word, s.id);
  return m;
}

/** A draft whose reveal time has come. */
export function dueToReveal(s: Pick<WordSet, "status" | "revealAt">, now: Date): boolean {
  return s.status === "draft" && s.revealAt !== null && s.revealAt.getTime() <= now.getTime();
}

// --- settings ---------------------------------------------------------------------------------

export interface SetSettings {
  name: string;
  revealAt: Date | null;
  releaseAt: Date | null;
  gateHours: number;
  perPlayerLimit: number;
  sort: number;
  type: SetType;
  partnerName: string | null;
  partnerUrl: string | null;
  colorA: string | null;
  colorB: string | null;
  gateRule: GateRule;
  gateToken: string | null;
  gateMin: string | null;
  gateLabel: string | null;
}

/** The settings a player reads as the set's identity: locked once the set is revealed. */
export const IDENTITY_KEYS = ["name", "type", "partnerName", "partnerUrl", "colorA", "colorB"] as const satisfies readonly (keyof SetSettings)[];
/** The settings of the plan and the first day: they can change until the release. */
export const SCHEDULE_KEYS = ["revealAt", "releaseAt", "gateHours", "perPlayerLimit", "gateRule", "gateToken", "gateMin", "gateLabel"] as const satisfies readonly (keyof SetSettings)[];

/** What a new set starts with, beyond its name. */
export const SETTINGS_DEFAULTS: Omit<SetSettings, "name" | "sort"> = {
  revealAt: null,
  releaseAt: null,
  gateHours: GATE_HOURS_DEFAULT,
  perPlayerLimit: PER_PLAYER_DEFAULT,
  type: "standard",
  partnerName: null,
  partnerUrl: null,
  colorA: null,
  colorB: null,
  gateRule: "verified",
  gateToken: null,
  gateMin: null,
  gateLabel: null,
};

function parseDate(v: unknown, label: string, errors: string[]): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") {
    errors.push(`${label} must be a date`);
    return undefined;
  }
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) {
    errors.push(`${label} isn't a date`);
    return undefined;
  }
  return d;
}

/**
 * Check a set's settings as typed or pasted. Gives only the fields that were present, so the same
 * check serves "create" (the caller fills the defaults) and "edit one field".
 */
export function checkSettings(raw: Record<string, unknown>): { ok: true; value: Partial<SetSettings> } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const value: Partial<SetSettings> = {};
  if (raw.name !== undefined) {
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) errors.push("a set needs a name");
    else if (name.length > NAME_MAX) errors.push(`a name is at most ${NAME_MAX} characters`);
    else value.name = name;
  }
  const revealAt = parseDate(raw.revealAt, "revealAt", errors);
  if (revealAt !== undefined) value.revealAt = revealAt;
  const releaseAt = parseDate(raw.releaseAt, "releaseAt", errors);
  if (releaseAt !== undefined) value.releaseAt = releaseAt;
  const whole = (v: unknown, label: string, min: number, max: number): number | undefined => {
    if (v === undefined) return undefined;
    const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
    if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
      errors.push(`${label} must be a whole number from ${min} to ${max}`);
      return undefined;
    }
    return n;
  };
  const gateHours = whole(raw.gateHours, "gateHours", 0, GATE_HOURS_MAX);
  if (gateHours !== undefined) value.gateHours = gateHours;
  const perPlayerLimit = whole(raw.perPlayerLimit, "perPlayerLimit", 1, PER_PLAYER_MAX);
  if (perPlayerLimit !== undefined) value.perPlayerLimit = perPlayerLimit;
  const sort = whole(raw.sort, "sort", 0, 1_000_000);
  if (sort !== undefined) value.sort = sort;

  // What a collab adds. An empty or null value clears a field; a bad one is an error, never a guess.
  const empty = (v: unknown) => v === null || (typeof v === "string" && v.trim() === "");
  if (raw.type !== undefined) {
    if (SET_TYPES.includes(raw.type as SetType)) value.type = raw.type as SetType;
    else errors.push(`type must be one of: ${SET_TYPES.join(", ")}`);
  }
  if (raw.partnerName !== undefined) {
    if (empty(raw.partnerName)) value.partnerName = null;
    else if (typeof raw.partnerName !== "string" || raw.partnerName.trim().length > NAME_MAX) errors.push(`a partner's name is at most ${NAME_MAX} characters`);
    else value.partnerName = raw.partnerName.trim();
  }
  if (raw.partnerUrl !== undefined) {
    if (empty(raw.partnerUrl)) value.partnerUrl = null;
    else {
      const url = cleanUrl(raw.partnerUrl);
      if (url) value.partnerUrl = url;
      else errors.push("a partner's link must start with https://");
    }
  }
  for (const key of ["colorA", "colorB"] as const) {
    if (raw[key] === undefined) continue;
    if (empty(raw[key])) value[key] = null;
    else {
      const c = cleanColor(raw[key]);
      if (c) value[key] = c;
      else errors.push(`${key} must be a color like #1f6f8b`);
    }
  }
  if (raw.gateRule !== undefined) {
    if (GATE_RULES.includes(raw.gateRule as GateRule)) value.gateRule = raw.gateRule as GateRule;
    else errors.push(`gateRule must be one of: ${GATE_RULES.join(", ")}`);
  }
  if (raw.gateToken !== undefined) {
    if (empty(raw.gateToken)) value.gateToken = null;
    else {
      const a = cleanWallet(raw.gateToken);
      if (a) value.gateToken = a;
      else errors.push("gateToken must be a contract address");
    }
  }
  if (raw.gateLabel !== undefined) {
    if (empty(raw.gateLabel)) value.gateLabel = null;
    else if (typeof raw.gateLabel !== "string" || raw.gateLabel.trim().length > NAME_MAX) errors.push(`gateLabel is at most ${NAME_MAX} characters`);
    else value.gateLabel = raw.gateLabel.trim();
  }
  if (raw.gateMin !== undefined) {
    if (empty(raw.gateMin)) value.gateMin = null;
    else {
      const n = cleanAmount(raw.gateMin);
      if (n) value.gateMin = n;
      else errors.push("gateMin must be a whole number above zero, in the token's smallest unit");
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value };
}

/** A set is revealed before it is released, when both are dated. */
export function scheduleError(s: Pick<SetSettings, "revealAt" | "releaseAt">): string | null {
  if (s.revealAt && s.releaseAt && s.revealAt.getTime() > s.releaseAt.getTime()) return "the reveal must come before the release";
  return null;
}

// --- words ------------------------------------------------------------------------------------

export interface WordCheck {
  /** Words that may go in, cleaned, once each. */
  ok: string[];
  /** Not five letters A to Z. */
  malformed: string[];
  /** Well formed, but not in the dictionary. */
  unknown: string[];
  /** Already in another set (a word is in one set at most). */
  taken: string[];
}

/**
 * Sort a list of candidate words for one set. `taken` is every word some OTHER set holds.
 * A word given twice counts once.
 */
export function checkWords(raw: readonly unknown[], isWord: (w: string) => boolean, taken: ReadonlySet<string>): WordCheck {
  const out: WordCheck = { ok: [], malformed: [], unknown: [], taken: [] };
  const seen = new Set<string>();
  for (const r of raw) {
    const w = cleanWord(r);
    if (!w) {
      out.malformed.push(String(r).slice(0, 24));
      continue;
    }
    if (seen.has(w)) continue;
    seen.add(w);
    if (!isWord(w)) out.unknown.push(w);
    else if (taken.has(w)) out.taken.push(w);
    else out.ok.push(w);
  }
  return out;
}

// --- import / export --------------------------------------------------------------------------

export interface ImportSet extends SetSettings {
  words: SetWord[];
}

/** The JSON the admin exports and takes back. `status` is exported for the reader; an import ignores it. */
export interface SetsFile {
  v: 1;
  sets: {
    name: string;
    status?: SetStatus;
    revealAt: string | null;
    releaseAt: string | null;
    gateHours: number;
    perPlayerLimit: number;
    sort: number;
    words: string[];
    headliners: string[];
    /** What a collab adds. Left out for a standard set with the default rule. A stamp and an allowlist are never in a file: they are their own imports. */
    type?: SetType;
    partnerName?: string | null;
    partnerUrl?: string | null;
    colorA?: string | null;
    colorB?: string | null;
    gateRule?: GateRule;
    gateToken?: string | null;
    gateMin?: string | null;
    gateLabel?: string | null;
  }[];
}

/** Every unreleased set as a file: what the operator saves, edits, and pastes back. */
export function exportSets(sets: readonly WordSet[]): SetsFile {
  return {
    v: 1,
    sets: sets
      .filter((s) => s.status !== "released")
      .slice()
      .sort((a, b) => a.sort - b.sort || a.id - b.id)
      .map((s) => ({
        name: s.name,
        status: s.status,
        revealAt: s.revealAt ? s.revealAt.toISOString() : null,
        releaseAt: s.releaseAt ? s.releaseAt.toISOString() : null,
        gateHours: s.gateHours,
        perPlayerLimit: s.perPlayerLimit,
        sort: s.sort,
        words: s.words.map((w) => w.word).sort(),
        headliners: s.words.filter((w) => w.headliner).map((w) => w.word).sort(),
        ...(s.type === "collab" ? { type: s.type, partnerName: s.partnerName, partnerUrl: s.partnerUrl, colorA: s.colorA, colorB: s.colorB } : {}),
        ...(s.gateRule !== "verified" ? { gateRule: s.gateRule, gateToken: s.gateToken, gateMin: s.gateMin, gateLabel: s.gateLabel } : {}),
      })),
  };
}

/**
 * Read a pasted file into draft sets. Every problem is reported at once, and nothing is imported
 * unless the whole file is clean (half an import would leave words in the wrong sets).
 *
 * `locked` is every word a revealed or released set already holds: an import only ever makes
 * drafts, so it can't take one of those.
 */
export function parseSetsFile(
  text: string,
  isWord: (w: string) => boolean,
  locked: ReadonlySet<string>,
): { ok: true; sets: ImportSet[] } | { ok: false; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ["that isn't JSON"] };
  }
  const list = Array.isArray(data) ? data : (data as { sets?: unknown } | null)?.sets;
  if (!Array.isArray(list)) return { ok: false, errors: ['expected { "sets": [ … ] }'] };
  if (list.length > IMPORT_MAX_SETS) return { ok: false, errors: [`at most ${IMPORT_MAX_SETS} sets in one file`] };

  const errors: string[] = [];
  const sets: ImportSet[] = [];
  const used = new Map<string, string>(); // word → the set in this file that took it
  list.forEach((raw, i) => {
    const at = `set ${i + 1}`;
    if (!raw || typeof raw !== "object") return void errors.push(`${at}: not an object`);
    const r = raw as Record<string, unknown>;
    // A revealed set in an exported file is there for the reader. Its words are locked, so it is
    // left as it stands, never re-made as a draft.
    if (r.status === "revealed" || r.status === "released") return;
    const settings = checkSettings({ ...r, name: r.name ?? "" });
    if (!settings.ok) return void errors.push(...settings.errors.map((e) => `${at}: ${e}`));
    const s = settings.value;
    const label = s.name ? `"${s.name}"` : at;
    const sched = scheduleError({ revealAt: s.revealAt ?? null, releaseAt: s.releaseAt ?? null });
    if (sched) errors.push(`${label}: ${sched}`);
    if (!Array.isArray(r.words)) return void errors.push(`${label}: "words" must be a list`);
    // A word is either a string or { word, headliner }; a separate "headliners" list works too.
    const flagged = new Set<string>();
    const names: unknown[] = [];
    for (const w of r.words as unknown[]) {
      if (w && typeof w === "object") {
        const o = w as { word?: unknown; headliner?: unknown };
        names.push(o.word);
        const c = cleanWord(o.word);
        if (c && o.headliner === true) flagged.add(c);
      } else names.push(w);
    }
    if (r.headliners !== undefined) {
      if (!Array.isArray(r.headliners)) errors.push(`${label}: "headliners" must be a list`);
      else for (const h of r.headliners as unknown[]) {
        const c = cleanWord(h);
        if (!c) errors.push(`${label}: a headliner isn't a word`);
        else flagged.add(c);
      }
    }
    const check = checkWords(names, isWord, locked);
    if (check.malformed.length) errors.push(`${label}: not five letters: ${check.malformed.join(", ")}`);
    if (check.unknown.length) errors.push(`${label}: not in the dictionary: ${check.unknown.join(", ")}`);
    if (check.taken.length) errors.push(`${label}: already in a revealed or released set: ${check.taken.join(", ")}`);
    for (const w of check.ok) {
      const other = used.get(w);
      if (other) errors.push(`${label}: ${w} is also in ${other}`);
      else used.set(w, label);
    }
    for (const h of flagged) if (!check.ok.includes(h)) errors.push(`${label}: headliner ${h} isn't one of the set's words`);
    sets.push({
      ...SETTINGS_DEFAULTS,
      ...s,
      name: s.name ?? "",
      sort: s.sort ?? i,
      words: check.ok.map((word) => ({ word, headliner: flagged.has(word) })),
    });
  });
  return errors.length ? { ok: false, errors } : { ok: true, sets };
}

// --- the commitment ---------------------------------------------------------------------------

/**
 * The canonical JSON of every unreleased set: what the commitment hashes.
 *
 * Only what the promise is about goes in: each set's name, its words, and its headliners. The dates,
 * the gate's settings, and the display order can change without changing the list, and a status
 * moving from draft to revealed changes nothing a player was promised, so none of those are in it.
 * Fixed key order, words A to Z, sets by name (then by first word), no whitespace: anyone handed the
 * sets later can rebuild the same bytes.
 */
export function canonicalSets(sets: readonly Pick<WordSet, "name" | "status" | "words">[]): string {
  const rows = sets
    .filter((s) => s.status !== "released")
    .map((s) => ({
      name: s.name,
      words: s.words.map((w) => w.word).sort(),
      headliners: s.words.filter((w) => w.headliner).map((w) => w.word).sort(),
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : (a.words[0] ?? "") < (b.words[0] ?? "") ? -1 : 1));
  return JSON.stringify({ v: 1, sets: rows.map((r) => ({ name: r.name, words: r.words, headliners: r.headliners })) });
}

/** keccak256 of `canonicalSets`: the hash the owner can publish before anyone has seen a set. */
export function commitmentOf(sets: readonly Pick<WordSet, "name" | "status" | "words">[]): `0x${string}` {
  return keccak256(stringToBytes(canonicalSets(sets)));
}

// --- roots ------------------------------------------------------------------------------------

/**
 * Releasing a set: the words to hold back afterwards, and what the change does.
 *
 * Built from what the CHAIN holds back now, never from the sets table: a release adds this set's
 * words to the tree the chain has and touches nothing else, so it can never remove a word, whatever
 * draft edits are still waiting for their own root.
 */
export function releaseChange(chainHeld: ReadonlySet<string>, setWords: readonly string[]) {
  const mine = new Set(setWords);
  return {
    /** The held-back words after the release. */
    held: [...chainHeld].filter((w) => !mine.has(w)).sort(),
    /** Words the new root adds: the set's words the chain was holding back. */
    added: setWords.filter((w) => chainHeld.has(w)).sort(),
    /** The set's words the chain was NOT holding back: they were claimable all along. */
    neverHeld: setWords.filter((w) => !chainHeld.has(w)).sort(),
  };
}

/** Moving the chain's root to what the sets say: what it newly holds back, and what it lets go. */
export function reserveChange(chainHeld: ReadonlySet<string>, wanted: ReadonlySet<string>) {
  return {
    held: [...wanted].sort(),
    /** Newly held back: in the chain's tree now, out of the next one. */
    removed: [...wanted].filter((w) => !chainHeld.has(w)).sort(),
    /** Let go: held back on the chain, but in no unreleased set any more. */
    added: [...chainHeld].filter((w) => !wanted.has(w)).sort(),
  };
}

/**
 * When a release's gate lifts, in seconds: the gate's length after the release (the planned time, or
 * now if that has passed). Null for a set with no gate. An error when it is further ahead than the
 * contract allows: build the release nearer its time.
 */
export function gateUntilFor(nowSec: number, s: Pick<WordSet, "releaseAt" | "gateHours">): { until: number | null } | { error: string } {
  if (s.gateHours <= 0) return { until: null };
  const releaseSec = s.releaseAt ? Math.floor(s.releaseAt.getTime() / 1000) : nowSec;
  const until = Math.max(nowSec, releaseSec) + s.gateHours * 3600;
  if (until - nowSec > GATE_HOURS_MAX * 3600) {
    return { error: `the gate would end more than ${GATE_HOURS_MAX / 24} days from now, which the contract refuses: build the release nearer its time` };
  }
  return { until };
}

// --- what a player's browser is told ----------------------------------------------------------

/** A collab set as the game shows it: the partner, the two card colors, and where the stamp is served. */
export interface PublicCollab {
  partner: string;
  /** The partner's link (https), or null. */
  url: string | null;
  colorA: string;
  colorB: string;
  /** The stamp's address on this site, or null when the set has none. It answers only for a revealed set. */
  stamp: string | null;
}

/** What a revealed or released set says beyond its words. */
interface PublicShown {
  id: number;
  name: string;
  words: SetWord[];
  /** Set for a collab set, null for a standard one. */
  collab: PublicCollab | null;
  /** Who the first day is open to. A token's contract and an allowlist's wallets are never sent. */
  firstDay: GateRule;
  /** The operator's words for who an allowlist or a token rule lets in, or null. */
  firstDayLabel: string | null;
}

export type PublicSet =
  /** A draft: a slot, and nothing else. No name, no word, no count, no date, no id, no type. */
  | { kind: "locked" }
  | (PublicShown & { kind: "revealed"; releaseAt: string | null })
  | (PublicShown & {
      kind: "released";
      releasedAt: string | null;
      /** While this is in the future, the first-day limit applies. */
      gateUntil: string | null;
      perPlayerLimit: number;
    });

/** Where a set's stamp is served. The time is in the address so a browser keeps it for good. */
export function stampPath(id: number, at: Date): string {
  return `/api/sets/${id}/stamp?v=${Math.floor(at.getTime() / 1000)}`;
}

/** A set's collab look, or null: for a standard set, and for a collab that is missing a part (it can't have been revealed). */
export function collabOf(s: Pick<WordSet, "id" | "type" | "partnerName" | "partnerUrl" | "colorA" | "colorB" | "stampAt">): PublicCollab | null {
  if (s.type !== "collab" || !s.partnerName || !s.colorA || !s.colorB) return null;
  return { partner: s.partnerName, url: s.partnerUrl, colorA: s.colorA, colorB: s.colorB, stamp: s.stampAt ? stampPath(s.id, s.stampAt) : null };
}

/**
 * The sets as any visitor may see them. THE one place a set's contents become public: a draft is a
 * locked slot (and an empty draft isn't even that), whatever else the caller holds.
 */
export function publicSets(sets: readonly WordSet[]): PublicSet[] {
  return sets
    .slice()
    .sort((a, b) => a.sort - b.sort || a.id - b.id)
    .flatMap((s): PublicSet[] => {
      if (s.status === "draft") return s.words.length ? [{ kind: "locked" }] : [];
      const words = s.words.slice().sort((a, b) => Number(b.headliner) - Number(a.headliner) || (a.word < b.word ? -1 : 1));
      // A set with no first day has no rule to tell.
      const ruled = s.gateHours > 0 && s.gateRule !== "verified";
      const shown: PublicShown = { id: s.id, name: s.name, words, collab: collabOf(s), firstDay: ruled ? s.gateRule : "verified", firstDayLabel: ruled ? s.gateLabel : null };
      if (s.status === "revealed") {
        return [{ kind: "revealed", ...shown, releaseAt: s.releaseAt ? s.releaseAt.toISOString() : null }];
      }
      return [
        {
          kind: "released",
          ...shown,
          releasedAt: s.releasedAt ? s.releasedAt.toISOString() : null,
          gateUntil: s.gateUntil ? s.gateUntil.toISOString() : null,
          perPlayerLimit: s.perPlayerLimit,
        },
      ];
    });
}
