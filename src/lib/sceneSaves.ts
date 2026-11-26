/**
 * What `/api/scenes` accepts (decisions.md #15): pure parsing and checks, so they're tested.
 *
 * A save names each pick's word, its scene, the wallet holding the word, and when the player picked
 * it. The route lets a session save for any wallet in its profile account (lib/db/walletLinks), so
 * one sign-in covers every word in a unified profile; before wallet links, an account is one wallet.
 */
import { isAddress } from "viem";
import { isWord } from "./dictionary";
import { DEFAULT_SCENE, isSceneId, storedScene, type SceneId } from "./scenes";

/** Picks in one save: the local uploads after a sign-in, batched. */
export const MAX_PICKS_PER_SAVE = 50;
/** Wallets in one read: a bag's wallets (linked wallets are capped at 5). */
export const MAX_WALLETS_PER_READ = 8;
/** How far back a pick's time may claim to be (an old unsynced pick still uploads). */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SKEW_MS = 60_000;

export interface ScenePick {
  /** Lowercase wallet holding the word; the session's wallet when the client names none. */
  wallet: string;
  /** UPPERCASE dictionary word. */
  word: string;
  scene: SceneId;
  at: Date;
}

/** A pick as the browser keeps it: the scene, when it was picked (ms), and whether the server has it. */
export interface StoredPick {
  scene: SceneId;
  at: number;
  synced: boolean;
}

/**
 * A stored pick from its saved text. The first version saved the bare scene id: that reads as an
 * old, unsynced pick. A pick of a retired scene reads as the stock card, picked when it was
 * (lib/scenes, storedScene).
 */
export function parseStoredPick(raw: string | null): StoredPick | null {
  if (!raw) return null;
  if (isSceneId(raw)) return { scene: raw, at: 0, synced: false };
  // A first-version pick of a retired scene has no time, so it can't be ordered against anything,
  // and with no other pick the word stands on the stock card anyway: there is nothing to upload.
  if (storedScene(raw)) return { scene: DEFAULT_SCENE, at: 0, synced: true };
  try {
    const p = JSON.parse(raw) as Partial<StoredPick>;
    const scene = storedScene(p.scene);
    return scene ? { scene, at: Number(p.at) || 0, synced: p.synced === true } : null;
  } catch {
    return null;
  }
}

/**
 * The server's saved picks as the browser reads them: `wallet:word` → the scene (a retired one as
 * the stock card) and when it was picked. A row whose scene is nothing known is left out.
 */
export function readSavedPicks(rows: readonly { wallet: string; word: string; scene: string; at: number }[]): Map<string, { scene: SceneId; at: number }> {
  const out = new Map<string, { scene: SceneId; at: number }>();
  for (const r of rows) {
    const scene = storedScene(r.scene);
    if (scene) out.set(`${r.wallet}:${r.word}`, { scene, at: r.at });
  }
  return out;
}

/**
 * The scene to show when the browser and the server both have a pick: the newer one. A pick made
 * here before sign-in (not yet uploaded) beats an older saved one, and a newer pick from another
 * device beats this browser's. A tie is the same pick.
 */
export function newestPick(local: StoredPick | null, saved: { scene: SceneId; at: number } | null): SceneId | null {
  if (local && saved) return local.at > saved.at ? local.scene : saved.scene;
  return local?.scene ?? saved?.scene ?? null;
}

/** `?wallets=a,b` → lowercase addresses, or null when any is malformed or there are too many. */
export function parseWallets(raw: string | null): string[] | null {
  if (!raw) return null;
  const list = [...new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))];
  if (list.length === 0 || list.length > MAX_WALLETS_PER_READ) return null;
  return list.every((a) => isAddress(a, { strict: false })) ? list : null;
}

/**
 * `{ picks: [{ word, scene, at, wallet? }] }` → picks, or null for a bad request. A pick's time is
 * kept within the last 30 days and never in the future (the player's clock may be off a little).
 * Two picks for the same wallet and word collapse to the newer one: Postgres refuses an upsert that
 * names one row twice ("cannot affect row a second time"), so a duplicate would fail the whole save
 * (Bugbot on #164), and would count twice against the wallet's row cap.
 */
export function parsePicks(body: unknown, sessionWallet: string, now = Date.now()): ScenePick[] | null {
  const picks = (body as { picks?: unknown } | null)?.picks;
  if (!Array.isArray(picks) || picks.length === 0 || picks.length > MAX_PICKS_PER_SAVE) return null;
  const out = new Map<string, ScenePick>();
  for (const p of picks as { word?: unknown; scene?: unknown; at?: unknown; wallet?: unknown }[]) {
    if (typeof p?.word !== "string" || !isWord(p.word) || !isSceneId(p.scene)) return null;
    const wallet = p.wallet === undefined ? sessionWallet : p.wallet;
    if (typeof wallet !== "string" || !isAddress(wallet, { strict: false })) return null;
    const at = typeof p.at === "number" && Number.isFinite(p.at) ? p.at : now;
    const pick: ScenePick = {
      wallet: wallet.toLowerCase(),
      word: p.word.toUpperCase(),
      scene: p.scene,
      at: new Date(Math.min(now + MAX_SKEW_MS, Math.max(now - MAX_AGE_MS, at))),
    };
    const key = `${pick.wallet}:${pick.word}`;
    const seen = out.get(key);
    if (!seen || pick.at >= seen.at) out.set(key, pick);
  }
  return [...out.values()];
}
