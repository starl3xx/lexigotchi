"use client";
/**
 * Each letter's supply from the chain: how many can ever exist (`caps`), how many were minted, and
 * how many are left to mint (`available`). Chain game only: the practice game has no caps. Shared by
 * the word lookup ("Mint a pack" is offered only while the letter can still be minted) and the Mint
 * tab's odds (a sold-out letter leaves the draw), under one query, so both read it once.
 */
import { useQuery } from "@tanstack/react-query";
import { readLetterSupply } from "@/lib/onchain/reads";
import { NETWORK } from "@/lib/onchain/network";
import { useGame } from "./state";

/**
 * `fresh`: the Mint tab shows odds and "N left" FROM this read, so it reads again every minute while
 * it is open (and on each visit after 30 s). The lookup only asks "can it still be minted?", and
 * keeps an answer for five minutes.
 */
export function useLetterSupply(enabled = true, fresh = false) {
  const { state } = useGame();
  return useQuery({
    queryKey: ["letterSupply", NETWORK.id],
    enabled: enabled && state.chainBacked,
    staleTime: fresh ? 30_000 : 5 * 60_000,
    refetchInterval: fresh ? 60_000 : false,
    queryFn: readLetterSupply,
  });
}
