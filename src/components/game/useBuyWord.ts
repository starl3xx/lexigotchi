"use client";
/**
 * "Buy $WORD", wherever the player is. Inside a Farcaster client: the host's own swap modal, USDC to
 * $WORD pre-filled (older hosts: the token page). Anywhere else: Matcha's swap page, which routes
 * $WORD's Uniswap v4 (Clanker) pool. Pinned to Base MAINNET whatever network the game runs on: this
 * is the real token, which exists only there.
 */
import { useEffect, useState } from "react";
import { WORD_TOKEN } from "@/lib/wordStats";

const CAIP_WORD = `eip155:8453/erc20:${WORD_TOKEN}`;
/** USDC on Base: the default sell side of the pre-filled swap. */
const USDC = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const CAIP_USDC = `eip155:8453/erc20:${USDC}`;
export const BUY_URL = `https://matcha.xyz/tokens/base/${WORD_TOKEN}?buyAddress=${WORD_TOKEN}&buyChain=8453&sellAddress=${USDC}&sellChain=8453`;
const openBuy = () => void window.open(BUY_URL, "_blank", "noopener,noreferrer");

export function useBuyWord(): { buy: () => Promise<void>; env: "loading" | "farcaster" | "web" } {
  const [env, setEnv] = useState<"loading" | "farcaster" | "web">("loading");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        // isInMiniApp resolves a definitive boolean (it has its own timeout); awaiting it directly
        // avoids a race that could discard a slow-but-real "yes" and send a Farcaster player to the web.
        const inMini = await sdk.isInMiniApp();
        if (alive) setEnv(inMini ? "farcaster" : "web");
      } catch {
        if (alive) setEnv("web");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const buy = async () => {
    // The host's swap only when we've DEFINITELY detected a mini app; the web (and the unresolved
    // case) goes to Matcha.
    if (env !== "farcaster") {
      openBuy();
      return;
    }
    try {
      const sdk = (await import("@farcaster/miniapp-sdk")).default;
      await sdk.actions.swapToken({ sellToken: CAIP_USDC, buyToken: CAIP_WORD });
    } catch {
      try {
        const sdk = (await import("@farcaster/miniapp-sdk")).default;
        await sdk.actions.viewToken({ token: CAIP_WORD });
      } catch {
        openBuy();
      }
    }
  };
  return { buy, env };
}
