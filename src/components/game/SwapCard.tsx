"use client";
/**
 * Swap $WORD right on the $WORD page: buy with ETH or USDC, or sell for either, on Base mainnet
 * (whatever network the game runs on). Quotes and calldata from KyberSwap through /api/swap/*,
 * checked there (lib/swap/kyber: allowed pairs, the pinned router, recipient = you). The send goes
 * through the app's one write path with the builder suffix, no paymaster, and an exact-amount
 * approval for a token input. Inside Farcaster the page uses the host's own swap instead.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits, toHex } from "viem";
import { Button, Card, SectionTitle, Segmented } from "./primitives";
import { fmtWord, useGame } from "./state";
import { sendCallsAttributed, type Call, type Eip1193Provider } from "@/lib/onchain/sendCalls";
import { BASE } from "@/lib/onchain/network";
import { KYBER_ROUTER, MAX_IMPACT_PCT, SLIPPAGE_BPS, SWAP_TOKENS, minOut, type SwapSymbol } from "@/lib/swap/kyber";

type Side = "buy" | "sell";
type Other = "ETH" | "USDC";
type Phase = "idle" | "preparing" | "wallet" | "waiting";

interface Quote {
  ok: boolean;
  amountIn: string;
  amountOut: string;
  amountInUsd: number | null;
  amountOutUsd: number | null;
  priceImpactPct: number | null;
  routeSummary: unknown;
  error?: string;
}
type Balances = { ok: boolean } & Record<SwapSymbol, string>;

/** Keep a little ETH back for gas when the player taps Max. */
const GAS_RESERVE = 300_000_000_000_000n; // 0.0003 ETH
const SLIPPAGES = [50, 100, 300] as const;

function fmtAmount(sym: SwapSymbol, base: bigint): string {
  const n = Number(formatUnits(base, SWAP_TOKENS[sym].decimals));
  if (sym === "WORD") return `${fmtWord(n)} $WORD`;
  if (sym === "USDC") return `${n.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: n < 0.01 ? 6 : 4 })} ETH`;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

export function SwapCard() {
  const g = useGame();
  const qc = useQueryClient();
  const { address, connector } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [side, setSide] = useState<Side>("buy");
  const [other, setOther] = useState<Other>("ETH");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState<number>(SLIPPAGE_BPS.default);
  const [phase, setPhase] = useState<Phase>("idle");

  const from: SwapSymbol = side === "buy" ? other : "WORD";
  const to: SwapSymbol = side === "buy" ? "WORD" : other;
  const amountIn = useMemo(() => {
    try {
      const v = parseUnits(amount.trim() || "0", SWAP_TOKENS[from].decimals);
      return v > 0n ? v : null;
    } catch {
      return null;
    }
  }, [amount, from]);
  const debounced = useDebounced(amountIn?.toString() ?? "", 400);

  const quoteQ = useQuery({
    queryKey: ["swapQuote", from, to, debounced],
    queryFn: async (): Promise<Quote> => (await fetch(`/api/swap/quote?from=${from}&to=${to}&amount=${debounced}`)).json(),
    enabled: !!debounced && phase === "idle",
    refetchInterval: 20_000,
  });
  const balQ = useQuery({
    queryKey: ["swapBalances", address ?? null],
    queryFn: async (): Promise<Balances> => (await fetch(`/api/swap/balances?address=${address}`)).json(),
    enabled: !!address,
    refetchInterval: 30_000,
  });

  const quote = quoteQ.data?.ok && quoteQ.data.amountIn === debounced ? quoteQ.data : null;
  const out = quote ? BigInt(quote.amountOut) : null;
  const impact = quote?.priceImpactPct ?? null;
  const balance = balQ.data?.ok ? BigInt(balQ.data[from]) : null;
  const short = amountIn != null && balance != null && amountIn > balance;
  const tooBig = impact != null && impact > MAX_IMPACT_PCT;

  const setMax = () => {
    if (balance == null) return;
    const max = from === "ETH" ? (balance > GAS_RESERVE ? balance - GAS_RESERVE : 0n) : balance;
    setAmount(formatUnits(max, SWAP_TOKENS[from].decimals));
  };

  const swap = async () => {
    if (!address || !connector || !amountIn) return;
    setPhase("preparing");
    const before = balQ.data?.ok ? balQ.data.WORD : null;
    try {
      // A fresh quote and build at the moment of sending: the pool is small and moves.
      const fresh: Quote = await (await fetch(`/api/swap/quote?from=${from}&to=${to}&amount=${amountIn}`)).json();
      if (!fresh.ok) throw new Error("No route right now. Try again in a moment.");
      if ((fresh.priceImpactPct ?? 0) > MAX_IMPACT_PCT) throw new Error("That trade is too large for this pool.");
      const built = await (
        await fetch("/api/swap/build", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ routeSummary: fresh.routeSummary, sender: address, slippageBps: slippage }),
        })
      ).json();
      if (!built.ok || built.router !== KYBER_ROUTER) throw new Error("Couldn’t build that trade. Try again.");
      const calls: Call[] = [];
      if (from !== "ETH") {
        // Exact amount, never unlimited: this is a third-party router, not the game's contracts.
        calls.push({
          to: SWAP_TOKENS[from].address,
          data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [KYBER_ROUTER, BigInt(built.amountIn)] }),
        });
      }
      calls.push({ to: KYBER_ROUTER, data: built.data, value: BigInt(built.value) > 0n ? toHex(BigInt(built.value)) : undefined });
      const provider = (await connector.getProvider()) as Eip1193Provider;
      setPhase("wallet");
      await sendCallsAttributed(provider, address, calls, { network: BASE, sponsored: false });
      setPhase("waiting");
      // Read the balances until $WORD moves (a send returns when the wallet accepts, not when it lands).
      let landed = false;
      for (const wait of [2_000, 3_000, 5_000, 10_000]) {
        await new Promise((r) => setTimeout(r, wait));
        const b = (await balQ.refetch()).data;
        if (b?.ok && before != null && b.WORD !== before) {
          landed = true;
          break;
        }
      }
      void qc.invalidateQueries({ queryKey: ["word"] });
      setAmount("");
      g.toast(
        landed
          ? side === "buy"
            ? `Swapped. About ${fmtAmount("WORD", BigInt(built.amountOut))} is in your wallet.`
            : `Sold ${fmtAmount("WORD", BigInt(built.amountIn))}.`
          : "Sent. Your balance updates once Base confirms it.",
        landed ? "good" : "info",
      );
    } catch (err) {
      const msg = String((err as Error)?.message ?? "");
      const code = (err as { code?: number })?.code;
      g.toast(code === 4001 || /reject|denied/i.test(msg) ? "Cancelled" : msg.slice(0, 90) || "The swap didn’t go through", code === 4001 ? "info" : "bad");
    } finally {
      setPhase("idle");
    }
  };

  const label =
    phase === "preparing"
      ? "Getting the best price…"
      : phase === "wallet"
        ? "Confirm in your wallet"
        : phase === "waiting"
          ? "Waiting for Base…"
          : !address
            ? "Connect a wallet to swap"
            : short
              ? `Not enough ${from === "WORD" ? "$WORD" : from}`
              : tooBig
                ? "Too large for this pool"
                : side === "buy"
                  ? "Buy $WORD"
                  : "Sell $WORD";

  return (
    <Card>
      <SectionTitle>Swap</SectionTitle>
      <div className="space-y-3">
        <Segmented
          value={side}
          onChange={(v) => {
            setSide(v);
            setAmount("");
          }}
          options={[
            { value: "buy", label: "Buy" },
            { value: "sell", label: "Sell" },
          ]}
        />
        <div className="flex items-center justify-between gap-2 text-xs font-bold text-ink/60">
          <span>{side === "buy" ? "Pay with" : "Receive"}</span>
          <Segmented
            className="w-40"
            value={other}
            onChange={(v) => {
              setOther(v);
              setAmount("");
            }}
            options={[
              { value: "ETH", label: "ETH" },
              { value: "USDC", label: "USDC" },
            ]}
          />
        </div>

        <label className="block">
          <span className="flex items-center justify-between text-xs font-bold text-ink/60">
            <span>You pay ({from === "WORD" ? "$WORD" : from})</span>
            {balance != null && (
              <button type="button" onClick={setMax} className="underline">
                Balance {fmtAmount(from, balance)} · Max
              </button>
            )}
          </span>
          <input
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
            className="mt-1 w-full rounded-xl border-[3px] border-ink bg-card px-3 py-2.5 font-display text-xl font-extrabold tabular-nums placeholder:text-ink/30 focus:outline-none focus:ring-2 focus:ring-candy"
          />
        </label>

        <div className="rounded-xl border-2 border-dashed border-ink/25 px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-ink/60">You get about</span>
            <span className="font-display text-lg font-extrabold tabular-nums">
              {out != null ? fmtAmount(to, out) : amountIn && quoteQ.isFetching ? "…" : "–"}
            </span>
          </div>
          {quote && out != null && (
            <div className="mt-1 space-y-0.5 text-xs text-ink/60">
              <div className="flex justify-between">
                <span>At least, with {slippage / 100}% slippage</span>
                <span className="tabular-nums">{fmtAmount(to, minOut(out, slippage))}</span>
              </div>
              <div className="flex justify-between">
                <span>Price impact and fees</span>
                <span className={`tabular-nums ${impact != null && impact > 3 ? "font-bold text-candy-ink" : ""}`}>
                  {impact == null ? "–" : `${impact.toFixed(2)}%`}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs font-bold text-ink/60">
          <span className="mr-1">Max slippage</span>
          {SLIPPAGES.map((bps) => (
            <button
              key={bps}
              type="button"
              onClick={() => setSlippage(bps)}
              className={`round-btn rounded-full border-2 border-ink px-2 py-0.5 ${slippage === bps ? "bg-ink text-paper" : "bg-card text-ink"}`}
            >
              {bps / 100}%
            </button>
          ))}
        </div>

        <Button
          full
          variant="primary"
          disabled={phase !== "idle" || (!!address && (!amountIn || !quote || short || tooBig))}
          onClick={() => (address ? void swap() : openConnectModal?.())}
        >
          {label}
        </Button>
        <p className="text-xs text-ink/60">
          Swaps run on Base through KyberSwap’s router, which finds the best route to $WORD’s pool. The pool is
          small, so check the price impact on a large trade.
        </p>
      </div>
    </Card>
  );
}
