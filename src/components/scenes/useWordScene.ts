"use client";
/**
 * Each word's scene, and whether the player has unlocked the scenes past the Stage.
 *
 * Where a pick lives (decisions.md #15):
 * - In this browser, always, at once: a pick works offline, before sign-in, and in practice mode.
 *   Kept per wallet and word, like the server's rows, so two wallets used in one browser never share
 *   or swap picks. (The first version kept them per word only; those still read, and move to the new
 *   key the next time they're saved.)
 * - On the server too (`/api/scenes`, keyed by the wallet holding the word), when profiles are on
 *   and the player already has a profile session. One session saves for every wallet in their
 *   profile (starl3xx, 2026-11-24: "yes re scenes"), so a pick follows them to every device and
 *   host. A pick never asks to sign in: without a session it waits in the browser, and goes up the
 *   next time a session exists (useSceneSync, mounted once by GameApp).
 * When both have a pick for a word, the newer wins (lib/sceneSaves.ts, newestPick), and a save that
 * comes back late never marks an older pick as the current one.
 *
 * One store for the whole page, so the Today stage, the scene sheet, and the Showcase all see a
 * change at once; the `storage` event carries a change made in another tab.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient, type QueryClient, type QueryKey } from "@tanstack/react-query";
import { useGame } from "../game/state";
import { useProfileSession, usePublicProfile } from "../game/useProfile";
import { DEFAULT_SCENE, SCENE_UNLOCK_WORDS, isSceneId, scenesUnlocked, type SceneId } from "@/lib/scenes";
import { MAX_PICKS_PER_SAVE, newestPick, parseStoredPick, type StoredPick } from "@/lib/sceneSaves";

const PREFIX = "lexigotchi:scene:";
/** The holder when there is no wallet at all (practice mode, signed out). */
const LOCAL = "local";
const keyOf = (holder: string, word: string) => `${PREFIX}${holder}:${word.toUpperCase()}`;
/** The first version's key: the word alone. */
const legacyKeyOf = (word: string) => `${PREFIX}${word.toUpperCase()}`;
const SESSION_HEADER = "x-lexigotchi-session";
const listeners = new Set<() => void>();
// Storage blocked (some embedded browsers): picks last until the page reloads.
const memory = new Map<string, string>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  window.addEventListener("storage", fn);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", fn);
  };
}

function getItem(k: string): string | null {
  if (memory.has(k)) return memory.get(k)!;
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}

/** A holder's pick for a word, falling back to the first version's word-only key. */
function readRaw(holder: string, word: string): string | null {
  return getItem(keyOf(holder, word)) ?? getItem(legacyKeyOf(word));
}

function writeLocal(holder: string, word: string, pick: StoredPick) {
  const k = keyOf(holder, word);
  const raw = JSON.stringify(pick);
  try {
    window.localStorage.setItem(k, raw);
    window.localStorage.removeItem(legacyKeyOf(word)); // moved to its wallet's key
  } catch {
    memory.set(k, raw);
  }
  listeners.forEach((fn) => fn());
}

/** Every pick this browser holds: its holder (null for a first-version, word-only key), word, and pick. */
function allLocal(): { holder: string | null; word: string; pick: StoredPick }[] {
  const out = new Map<string, { holder: string | null; word: string; pick: StoredPick }>();
  const take = (k: string, raw: string | null) => {
    const pick = parseStoredPick(raw);
    if (!pick) return;
    const rest = k.slice(PREFIX.length);
    const cut = rest.lastIndexOf(":");
    out.set(k, cut < 0 ? { holder: null, word: rest, pick } : { holder: rest.slice(0, cut), word: rest.slice(cut + 1), pick });
  };
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) take(k, window.localStorage.getItem(k));
    }
  } catch {
    /* storage blocked */
  }
  for (const [k, raw] of memory) take(k, raw);
  return [...out.values()];
}

/**
 * The scenes unlock: how many words the player has ever held (the whole bag, linked wallets too, a
 * dissolved word still counted), and how many it takes. Once reached, it stays reached. While the
 * words are unknown (still loading, or the read failed) nothing is locked: "0 words" would be wrong.
 */
export function useSceneUnlock() {
  const { state } = useGame();
  // `|| 0`: a state made before the field existed (a hot reload keeps the old one) has none, and
  // Math.max with undefined is NaN, which locked every scene ("You're at NaN").
  const count = Math.max(state.words.length, state.wordsEverHeld || 0);
  const known = !state.wordsLoading && !state.wordsError;
  return { count, need: SCENE_UNLOCK_WORDS, unlocked: scenesUnlocked(count) || !known };
}

type SavedMap = Map<string, { scene: SceneId; at: number }>;
const savedKey = (wallet: string, word: string) => `${wallet}:${word}`;

/**
 * The scenes the server holds for the bag's wallets, and what's needed to save one: the profile
 * session, the wallets it may save for (its profile account's), and each word's holder.
 */
function useSaved() {
  const { state } = useGame();
  const session = useProfileSession();
  const accountWallets = usePublicProfile().profile?.wallets;
  // The server accepts a save for any wallet in the session's profile account (/api/scenes).
  const canWrite = useMemo(
    () => new Set([...(accountWallets ?? []).map((a) => a.toLowerCase()), ...(session.address ? [session.address] : [])]),
    [accountWallets, session.address],
  );
  const wallets = useMemo(() => {
    const set = new Set(state.words.map((w) => w.holder).filter((h): h is string => !!h));
    if (session.address) set.add(session.address);
    return [...set].sort();
  }, [state.words, session.address]);
  const on = session.enabled && state.chainBacked && wallets.length > 0;
  const queryKey = useMemo(() => ["wordScenes", wallets.join(",")], [wallets]);
  const saved = useQuery({
    queryKey,
    enabled: on,
    staleTime: 60_000,
    queryFn: async (): Promise<SavedMap | null> => {
      const r = await fetch(`/api/scenes?wallets=${wallets.join(",")}`);
      if (!r.ok) return null; // switched off, or migration 0009 not run yet: the browser's picks only
      const d = (await r.json()) as { ok: boolean; scenes?: { wallet: string; word: string; scene: string; at: number }[] };
      const out: SavedMap = new Map();
      for (const s of d.scenes ?? []) if (isSceneId(s.scene)) out.set(savedKey(s.wallet, s.word), { scene: s.scene, at: s.at });
      return out;
    },
  });
  // The connected wallet's own words carry no `holder`; a linked wallet's carry theirs.
  const holderOf = useCallback(
    (word: string) => state.words.find((w) => w.word === word.toUpperCase())?.holder ?? session.address ?? LOCAL,
    [state.words, session.address],
  );
  return { on, session, saved: saved.data ?? null, queryKey, holderOf, canWrite };
}

/** Upload picks to the server, all for one wallet. Resolves true when they were saved. */
async function upload(token: string, picks: { word: string; scene: SceneId; at: number; wallet: string }[], forget: () => void): Promise<boolean> {
  const r = await fetch("/api/scenes", {
    method: "PUT",
    headers: { "content-type": "application/json", [SESSION_HEADER]: token },
    body: JSON.stringify({ picks }),
  }).catch(() => null);
  if (r?.status === 401) forget();
  return Boolean(r?.ok);
}

/**
 * After a save lands: mark the browser's pick synced, and show it as saved, only if it is still the
 * pick that was uploaded. A newer pick made meanwhile stays as it is (and the newer save, or the
 * next sync, takes it up), so a late answer can't put an older scene back.
 */
function landed(qc: QueryClient, queryKey: QueryKey, holder: string, word: string, scene: SceneId, at: number) {
  const cur = parseStoredPick(readRaw(holder, word));
  if (cur && cur.at === at) writeLocal(holder, word, { ...cur, synced: true });
  qc.setQueryData<SavedMap | null>(queryKey, (m) => {
    const was = m?.get(savedKey(holder, word));
    return was && was.at > at ? m : new Map(m ?? []).set(savedKey(holder, word), { scene, at });
  });
}

/**
 * A word's scene: the one to draw (`scene`, the Stage while the others are locked), the player's
 * pick (`chosen`), and a setter.
 */
export function useWordScene(word: string | undefined) {
  const { unlocked } = useSceneUnlock();
  const qc = useQueryClient();
  const { on, session, saved, queryKey, holderOf, canWrite } = useSaved();
  const W = word?.toUpperCase();
  const holder = W ? holderOf(W) : LOCAL;
  const raw = useSyncExternalStore(subscribe, () => (W ? readRaw(holder, W) : null), () => null);
  const local = useMemo(() => parseStoredPick(raw), [raw]);
  const fromServer = W && saved ? (saved.get(savedKey(holder, W)) ?? null) : null;
  const chosen = newestPick(local, fromServer);

  const set = useCallback(
    (scene: SceneId) => {
      if (!W) return;
      const at = Date.now();
      writeLocal(holder, W, { scene, at, synced: false });
      // Saved on the server only under a session the player already has, for a wallet in their
      // profile; otherwise it waits here for useSceneSync.
      if (!on || !session.token || !canWrite.has(holder)) return;
      void upload(session.token, [{ word: W, scene, at, wallet: holder }], session.forget).then((ok) => {
        if (ok) landed(qc, queryKey, holder, W, scene, at);
      });
    },
    [W, holder, on, session.token, session.forget, canWrite, qc, queryKey],
  );
  // The pick shows once the scenes are open; `unlocked` also covers words not known yet
  // (useSceneUnlock), which a bare count would lock.
  const scene = chosen && (unlocked || chosen === DEFAULT_SCENE) ? chosen : DEFAULT_SCENE;
  return { scene, chosen, set };
}

/**
 * Upload the picks this browser made without a session, once one exists: every unsynced pick for a
 * word held by a wallet of the player's profile, one save per wallet. Mounted once (GameApp).
 */
export function useSceneSync() {
  const { state } = useGame();
  const qc = useQueryClient();
  const { on, session, queryKey, holderOf, canWrite } = useSaved();
  const tried = useRef<string>("");
  useEffect(() => {
    if (!on || !session.token) return;
    const token = session.token;
    const inBag = new Set(state.words.map((w) => w.word));
    const byWallet = new Map<string, { word: string; scene: SceneId; at: number }[]>();
    for (const e of allLocal()) {
      if (e.pick.synced || !inBag.has(e.word)) continue;
      const holder = holderOf(e.word);
      // A pick kept for one wallet never goes up as another's (a word-only key means this holder).
      if ((e.holder ?? holder) !== holder || !canWrite.has(holder)) continue;
      let at = e.pick.at;
      if (!at) {
        // A first-version pick has no time: give it one here, so its save can be matched on return.
        at = Date.now();
        writeLocal(holder, e.word, { ...e.pick, at });
      }
      const list = byWallet.get(holder) ?? [];
      if (list.length < MAX_PICKS_PER_SAVE) list.push({ word: e.word, scene: e.pick.scene, at });
      byWallet.set(holder, list);
    }
    if (byWallet.size === 0) return;
    const sig = `${token}|${[...byWallet].map(([w, ps]) => `${w}:${ps.map((p) => `${p.word}:${p.scene}:${p.at}`).join(",")}`).join(";")}`;
    if (tried.current === sig) return; // one try per set of picks per session
    tried.current = sig;
    for (const [wallet, picks] of byWallet) {
      void upload(token, picks.map((p) => ({ ...p, wallet })), session.forget).then((ok) => {
        if (ok) for (const p of picks) landed(qc, queryKey, wallet, p.word, p.scene, p.at);
      });
    }
  }, [on, session.token, session.forget, state.words, holderOf, canWrite, qc, queryKey]);
}
