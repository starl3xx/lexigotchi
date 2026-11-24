"use client";
/**
 * Each word's scene, and whether the player has unlocked the scenes past the Stage.
 *
 * Where a pick lives (decisions.md #15):
 * - In this browser, always, at once: a pick works offline, before sign-in, and in practice mode.
 * - On the server too (`/api/scenes`, keyed by the wallet holding the word), when profiles are on
 *   and the player already has a profile session. Then it follows them to every device and host.
 *   A pick never asks to sign in: without a session it waits in the browser, and goes up the next
 *   time a session exists (useSceneSync, mounted once by GameApp).
 * When both have a pick for a word, the newer wins (lib/sceneSaves.ts, newestPick).
 *
 * One store for the whole page, so the Today stage, the scene sheet, and the Showcase all see a
 * change at once; the `storage` event carries a change made in another tab.
 */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useGame } from "../game/state";
import { useProfileSession } from "../game/useProfile";
import { SCENE_UNLOCK_WORDS, isSceneId, scenesUnlocked, shownScene, type SceneId } from "@/lib/scenes";
import { MAX_PICKS_PER_SAVE, newestPick, parseStoredPick, type StoredPick } from "@/lib/sceneSaves";

const PREFIX = "lexigotchi:scene:";
const keyOf = (word: string) => `${PREFIX}${word.toUpperCase()}`;
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

function readRaw(word: string): string | null {
  const k = keyOf(word);
  if (memory.has(k)) return memory.get(k)!;
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}

function writeLocal(word: string, pick: StoredPick) {
  const k = keyOf(word);
  const raw = JSON.stringify(pick);
  try {
    window.localStorage.setItem(k, raw);
  } catch {
    memory.set(k, raw);
  }
  listeners.forEach((fn) => fn());
}

/** Every pick this browser holds, by word. */
function allLocal(): Map<string, StoredPick> {
  const out = new Map<string, StoredPick>();
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (!k?.startsWith(PREFIX)) continue;
      const p = parseStoredPick(window.localStorage.getItem(k));
      if (p) out.set(k.slice(PREFIX.length), p);
    }
  } catch {
    /* storage blocked */
  }
  for (const [k, raw] of memory) {
    const p = parseStoredPick(raw);
    if (p) out.set(k.slice(PREFIX.length), p);
  }
  return out;
}

/** The scenes unlock: how many words the player has ever held (the whole bag, linked wallets too, a
 *  dissolved word still counted), and how many it takes. Once reached, it stays reached. */
export function useSceneUnlock() {
  const { state } = useGame();
  // `|| 0`: a state made before the field existed (a hot reload keeps the old one) has none, and
  // Math.max with undefined is NaN, which locked every scene ("You're at NaN").
  const count = Math.max(state.words.length, state.wordsEverHeld || 0);
  return { count, need: SCENE_UNLOCK_WORDS, unlocked: scenesUnlocked(count) };
}

type SavedMap = Map<string, { scene: SceneId; at: number }>;
const savedKey = (wallet: string, word: string) => `${wallet}:${word}`;

/**
 * The scenes the server holds for the bag's wallets, and what's needed to save one: the profile
 * session, and the holder of each word (its wallet; the connected wallet for a word that has none).
 */
function useSaved() {
  const { state } = useGame();
  const session = useProfileSession();
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
  const holderOf = useCallback(
    (word: string) => state.words.find((w) => w.word === word)?.holder ?? session.address,
    [state.words, session.address],
  );
  return { on, session, saved: saved.data ?? null, queryKey, holderOf };
}

/** Upload picks to the server. Resolves true when they were saved. */
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
 * A word's scene: the one to draw (`scene`, the Stage while the others are locked), the player's
 * pick (`chosen`), and a setter.
 */
export function useWordScene(word: string | undefined) {
  const { count } = useSceneUnlock();
  const qc = useQueryClient();
  const { on, session, saved, queryKey, holderOf } = useSaved();
  const raw = useSyncExternalStore(subscribe, () => (word ? readRaw(word) : null), () => null);
  const local = useMemo(() => parseStoredPick(raw), [raw]);
  const holder = word ? holderOf(word) : null;
  const fromServer = word && holder && saved ? (saved.get(savedKey(holder, word.toUpperCase())) ?? null) : null;
  const chosen = newestPick(local, fromServer);

  const set = useCallback(
    (scene: SceneId) => {
      if (!word) return;
      const W = word.toUpperCase();
      const at = Date.now();
      writeLocal(W, { scene, at, synced: false });
      // Saved on the server only under a session the player already has, for a word their
      // connected wallet holds; otherwise it waits here for useSceneSync.
      if (!on || !session.token || !holder || holder !== session.address) return;
      void upload(session.token, [{ word: W, scene, at, wallet: holder }], session.forget).then((ok) => {
        if (!ok) return;
        writeLocal(W, { scene, at, synced: true });
        qc.setQueryData<SavedMap | null>(queryKey, (m) => new Map(m ?? []).set(savedKey(holder, W), { scene, at }));
      });
    },
    [word, on, session.token, session.address, session.forget, holder, qc, queryKey],
  );
  return { scene: shownScene(chosen, count), chosen, set };
}

/**
 * Upload the picks this browser made without a session, once one exists: every unsynced pick for a
 * word the connected wallet holds. Mounted once (GameApp). Words a linked wallet holds wait for that
 * wallet's own session (or a unified profile's).
 */
export function useSceneSync() {
  const { state } = useGame();
  const qc = useQueryClient();
  const { on, session, queryKey } = useSaved();
  const tried = useRef<string>("");
  useEffect(() => {
    if (!on || !session.token || !session.address) return;
    // `mine`: the connected wallet holds it (a chain word carries no `holder` for its own wallet).
    const mine = new Set(state.words.filter((w) => w.mine).map((w) => w.word));
    const pending = [...allLocal()].filter(([w, p]) => !p.synced && mine.has(w)).slice(0, MAX_PICKS_PER_SAVE);
    if (pending.length === 0) return;
    const sig = `${session.token}|${pending.map(([w, p]) => `${w}:${p.scene}:${p.at}`).join(",")}`;
    if (tried.current === sig) return; // one try per set of picks per session
    tried.current = sig;
    const wallet = session.address;
    const picks = pending.map(([w, p]) => ({ word: w, scene: p.scene, at: p.at || Date.now(), wallet }));
    void upload(session.token, picks, session.forget).then((ok) => {
      if (!ok) return;
      for (const [w, p] of pending) writeLocal(w, { ...p, synced: true });
      void qc.invalidateQueries({ queryKey });
    });
  }, [on, session.token, session.address, session.forget, state.words, qc, queryKey]);
}
