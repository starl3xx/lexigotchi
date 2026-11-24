/**
 * Who a wallet is, for any list of players (the world, the swap board): its account (linked
 * wallets, lib/db/walletLinks.ts) and its face (the account's chosen X or Farcaster identity, or the
 * Farcaster face of the wallet or its account's first wallet). Server-only. Never throws past a
 * Farcaster read: a profile read that fails falls back to Farcaster faces alone.
 */
import { accountsOf } from "@/lib/db/walletLinks";
import { profilesByAddress } from "@/lib/neynar";
import { publicProfileRows } from "@/lib/db/profiles";
import { mergePublicFaces, type PublicFace } from "./rules";
import { profilesEnabled } from "./session";

export async function playerFaces(
  wallets: Iterable<string>,
): Promise<{ accountFor: Map<string, string>; profiles: Record<string, PublicFace> }> {
  const shown = [...new Set([...wallets].map((w) => w.toLowerCase()))];
  // accountsOf never throws: without migration 0008 every wallet is its own account.
  const accountFor = await accountsOf(shown);
  const accounts = [...new Set(accountFor.values())];
  const fcAll = await profilesByAddress([...new Set([...shown, ...accounts])]);
  const farcaster: typeof fcAll = {};
  for (const w of shown) {
    const face = fcAll[w] ?? fcAll[accountFor.get(w) ?? w];
    if (face) farcaster[w] = face;
  }
  const accountRows = profilesEnabled() ? await publicProfileRows(accounts).catch(() => []) : [];
  const rowByAccount = new Map(accountRows.map((r) => [r.address, r]));
  const rows = shown.flatMap((w) => {
    const r = rowByAccount.get(accountFor.get(w) ?? w);
    return r ? [{ ...r, address: w }] : [];
  });
  return { accountFor, profiles: mergePublicFaces(farcaster, rows) };
}
