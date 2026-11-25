"use client";
/**
 * The chain game's Market data (decisions.md #29): the letters board, the player's own letter
 * listings, recent sales, and the retired swap's old offers. Plain reads of the Market's routes,
 * which do the checking against the chain; the actions (list, buy, cancel) live in
 * ChainGameProvider, where the wallet and the action gate are.
 *
 * The boards poll only while the Market is on screen. Sales load once for everyone (a sell form
 * anywhere suggests prices from them) and poll on the Market.
 */
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { NETWORK } from "@/lib/onchain/network";
import type { SeaportOrder } from "@/lib/onchain/seaport";
import type { PublicFace } from "@/lib/profile/rules";
import type { LetterAsk, LetterBook, LetterSaleStat, MarketSale, MyLetterListing, TierSaleStat } from "@/lib/market/types";

interface BookAnswer {
  book: Record<number, LetterBook>;
  profiles: Record<string, PublicFace>;
  /** The letters table isn't there yet: nothing can be listed. */
  closed: boolean;
}
interface SalesAnswer {
  sales: MarketSale[];
  letters: Record<number, LetterSaleStat>;
  tiers: Record<string, TierSaleStat>;
  profiles: Record<string, PublicFace>;
}
export interface OldSwap {
  maker: string;
  giveId: number;
  wantId: number;
  orderHash: string;
  order: SeaportOrder;
}

const NO_SALES: SalesAnswer = { sales: [], letters: {}, tiers: {}, profiles: {} };

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    const data = await res.json();
    return data?.ok ? (data as T) : null;
  } catch {
    return null;
  }
}

/** One listing's signed order, fetched when the player acts on it. Null when it is gone. */
export async function fetchLetterOrder(orderHash: string): Promise<{ order: SeaportOrder; signature: `0x${string}`; qty: number; available: number } | null> {
  return getJson(`/api/market/letters?order=${orderHash}`);
}
export async function fetchWordOrder(orderHash: string): Promise<{ order: SeaportOrder; signature: `0x${string}` } | null> {
  return getJson(`/api/swap/words?order=${orderHash}`);
}

export function useChainMarket(a: { enabled: boolean; onMarket: boolean; wallets: readonly string[] }) {
  const qc = useQueryClient();
  const wallets = useMemo(() => [...new Set(a.wallets.map((w) => w.toLowerCase()))].sort().join(","), [a.wallets]);

  const bookQ = useQuery({
    queryKey: ["market", "letters", NETWORK.id],
    queryFn: async (): Promise<BookAnswer> => {
      const data = await getJson<{ book: Record<number, LetterBook>; profiles?: Record<string, PublicFace>; open?: boolean }>("/api/market/letters");
      if (!data) throw new Error("letters board unavailable");
      // `open: false`: the server has no table for letter listings yet (before migration 0017).
      return { book: data.book ?? {}, profiles: data.profiles ?? {}, closed: data.open === false };
    },
    enabled: a.enabled && a.onMarket,
    staleTime: 10_000,
    refetchInterval: a.onMarket ? 15_000 : false,
    retry: 1,
  });

  const mineQ = useQuery({
    queryKey: ["market", "mine", NETWORK.id, wallets],
    queryFn: async () => (await getJson<{ listings: MyLetterListing[] }>(`/api/market/letters?mine=${wallets}`))?.listings ?? [],
    enabled: a.enabled && a.onMarket && wallets.length > 0,
    staleTime: 10_000,
    refetchInterval: a.onMarket ? 30_000 : false,
  });

  const salesQ = useQuery({
    queryKey: ["market", "sales", NETWORK.id],
    queryFn: async () => (await getJson<SalesAnswer>("/api/market/sales")) ?? NO_SALES,
    enabled: a.enabled,
    staleTime: 60_000,
    refetchInterval: a.onMarket ? 30_000 : false,
  });

  const oldSwapsQ = useQuery({
    queryKey: ["market", "oldSwaps", NETWORK.id, wallets],
    queryFn: async () => (await getJson<{ orders: OldSwap[] }>(`/api/swap/orders?maker=${wallets}`))?.orders ?? [],
    enabled: a.enabled && a.onMarket && wallets.length > 0,
    staleTime: 5 * 60_000,
  });

  /**
   * Read everything again. `changed`: this player just bought or cancelled, so ask the server to read
   * the chain now (the boards are kept a few seconds, and an RPC may show a write a moment late):
   * at once, then at 4 and 10 seconds, as the cancel flows already did.
   */
  const refresh = useCallback(
    async (changed = false) => {
      const read = async (fresh: boolean) => {
        if (fresh) {
          const [book, sold] = await Promise.all([
            getJson<{ book: Record<number, LetterBook>; profiles?: Record<string, PublicFace>; open?: boolean }>("/api/market/letters?fresh=1"),
            getJson<SalesAnswer>("/api/market/sales?fresh=1"),
          ]);
          if (book) qc.setQueryData<BookAnswer>(["market", "letters", NETWORK.id], { book: book.book ?? {}, profiles: book.profiles ?? {}, closed: book.open === false });
          if (sold) qc.setQueryData(["market", "sales", NETWORK.id], sold);
        }
        await qc.invalidateQueries({ queryKey: ["market", "mine"] });
        if (!fresh) await qc.invalidateQueries({ queryKey: ["market"] });
      };
      if (!changed) return read(false);
      for (const ms of [4_000, 10_000]) setTimeout(() => void read(true), ms);
      return read(true);
    },
    [qc],
  );

  const moreAsks = useCallback(async (letterId: number, offset: number) => {
    const data = await getJson<{ asks: LetterAsk[]; more: boolean; next: number }>(`/api/market/letters?letter=${letterId}&offset=${offset}`);
    return data ?? { asks: [], more: false, next: offset };
  }, []);

  // One object per change in the data, so the provider's big memo doesn't rebuild on every render.
  const loading = a.enabled && a.onMarket && bookQ.isPending;
  return useMemo(
    () => ({
      letterBook: bookQ.data?.book ?? {},
      lettersClosed: bookQ.data?.closed ?? false,
      myLetters: mineQ.data ?? [],
      sales: salesQ.data?.sales ?? [],
      letterStats: salesQ.data?.letters ?? {},
      tierStats: salesQ.data?.tiers ?? {},
      faces: { ...(salesQ.data?.profiles ?? {}), ...(bookQ.data?.profiles ?? {}) } as Record<string, PublicFace>,
      loading,
      // The board couldn't be read and there is nothing kept to show: not the same as "nothing for sale".
      unavailable: a.enabled && a.onMarket && bookQ.isError && !bookQ.data,
      oldSwaps: oldSwapsQ.data ?? [],
      refresh,
      moreAsks,
    }),
    [bookQ.data, bookQ.isError, mineQ.data, salesQ.data, oldSwapsQ.data, loading, a.enabled, a.onMarket, refresh, moreAsks],
  );
}
