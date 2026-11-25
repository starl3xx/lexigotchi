"use client";
/**
 * Shop — the cosmetics shop's numbers and its owner actions (decisions.md #22): revenue to date,
 * $WORD sent to the Rewards Pool, USDC waiting for a sweep, sales per item, the live settings, and
 * the transaction builders (add, update, on/off sale, revenue wallet, split, pause, the route).
 *
 * Adding an item takes two steps: `addItem` here, then its row in the `shop_items` table (name, kind,
 * art). The game shows nothing without that row, except a plain "Test item" card on a test network.
 * Never add an item on mainnet before its row exists.
 */
import { useMemo } from "react";
import { CONTRACT_BY_KEY } from "@/lib/admin/contracts";
import { shortAddr } from "@/lib/admin/format";
import { fmtUsdc } from "@/lib/shop/rules";
import { useDeployments } from "../useDeployments";
import { AdminCard, Banner, ErrorState, KeyVal, MetricCard, SectionLabel, Spinner, useFetch } from "../ui";
import { OperationForm } from "../TxPlan";
import { Coins, CurrencyDollar, Info, Storefront, Warning } from "../icons";
import { NETWORK } from "@/lib/onchain/network";

interface ShopPayload {
  ok: boolean;
  deployed: boolean;
  network: string;
  enabled?: boolean;
  shop?: string;
  usdc?: string;
  owner?: string;
  revenueWallet?: string;
  revenueBps?: number | null;
  maxSlippageBps?: number;
  maxSweepUsdc?: string;
  paused?: boolean | null;
  adapter?: string;
  pegSource?: string;
  pegPackUsdc?: string;
  floorPerUsdc?: string | null;
  pendingRoute?: { adapter: string; pegSource: string; pegPackUsdc: string; readyAt: number } | null;
  pendingUsdc?: string;
  totals?: { sales: number; grossUsdc: string; revenueUsdc: string; wordToPool: string; deferredEverUsdc: string; sweptUsdc: string };
  items?: {
    id: number;
    name: string | null;
    kind: string | null;
    priceUsdc: string;
    start: number;
    end: number;
    maxSupply: number;
    sold: number;
    active: boolean;
    grossUsdc: string;
    revenueUsdc: string;
  }[];
}

const usdc = (units: string | undefined, testnet: boolean) =>
  units === undefined ? "–" : `${testnet ? "" : "$"}${fmtUsdc(BigInt(units))}${testnet ? " test USDC" : ""}`;
const wordWhole = (wei: string | undefined) =>
  wei === undefined ? "–" : Number(BigInt(wei) / 10n ** 18n).toLocaleString("en-US");
const when = (sec: number) => (sec === 0 ? "–" : new Date(sec * 1000).toISOString().slice(0, 16).replace("T", " "));

export function ShopTab() {
  const d = useDeployments();
  const { data, loading, error, reload } = useFetch<ShopPayload>("/api/admin/shop");
  const contract = CONTRACT_BY_KEY.shop;
  const testnet = NETWORK.isTestnet;
  const groups = useMemo(() => {
    const m = new Map<string, typeof contract.fns>();
    for (const f of contract.fns.filter((x) => x.kind === "owner")) m.set(f.group, [...(m.get(f.group) ?? []), f]);
    return [...m.entries()];
  }, [contract]);
  const address = d?.contracts.shop ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Storefront weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Shop</h2>
      </div>

      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        Cosmetics for USDC. Each sale sends the studio&apos;s share straight to the revenue wallet and swaps the rest to $WORD for
        the Rewards Pool, in the same transaction. Adding an item is two steps: <strong>addItem</strong> below, then its row in{" "}
        <code>shop_items</code> (name, kind, art). Without that row the game shows nothing (on a test network, a plain
        &ldquo;Test item&rdquo; card). Never add a mainnet item before its row exists.
      </Banner>

      {loading && !data ? (
        <Spinner />
      ) : error ? (
        <ErrorState msg={error} onRetry={reload} />
      ) : !data?.deployed ? (
        <AdminCard>
          <p className="text-sm text-ink/70">No Shop on {data?.network ?? NETWORK.name} yet. Mainnet: DeployShop.s.sol (ask the owner first).</p>
        </AdminCard>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard icon={<CurrencyDollar weight="bold" />} label="Revenue to date" value={usdc(data.totals?.revenueUsdc, testnet)} sub={`${data.totals?.sales ?? 0} sales · ${usdc(data.totals?.grossUsdc, testnet)} paid`} />
            <MetricCard icon={<Coins weight="bold" />} label="$WORD to the pool" value={wordWhole(data.totals?.wordToPool)} sub="at purchase and by sweeps (bounty carve included)" />
            <MetricCard
              icon={<Warning weight="bold" />}
              label="USDC waiting"
              value={usdc(data.pendingUsdc, testnet)}
              sub={`${usdc(data.totals?.deferredEverUsdc, testnet)} waited ever · ${usdc(data.totals?.sweptUsdc, testnet)} swept`}
              tone={data.pendingUsdc && BigInt(data.pendingUsdc) > 0n ? "warning" : "ok"}
            />
            <MetricCard icon={<Storefront weight="bold" />} label="Items" value={String(data.items?.length ?? 0)} sub={data.enabled ? "SHOP_ENABLED is on" : "SHOP_ENABLED is off: hidden in the game"} />
          </div>

          {data.pendingRoute && (
            <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
              A route change is pending: adapter {shortAddr(data.pendingRoute.adapter)}, peg {shortAddr(data.pendingRoute.pegSource)} at{" "}
              {fmtUsdc(BigInt(data.pendingRoute.pegPackUsdc))} USDC a pack. It can be accepted from {when(data.pendingRoute.readyAt)} UTC.
            </Banner>
          )}

          <AdminCard title="Settings">
            <div className="grid gap-x-6 sm:grid-cols-2">
              <KeyVal k="Shop" v={data.shop ? shortAddr(data.shop) : "–"} mono />
              <KeyVal k="USDC" v={data.usdc ? shortAddr(data.usdc) : "–"} mono />
              <KeyVal k="Owner" v={data.owner ? shortAddr(data.owner) : "–"} mono />
              <KeyVal k="Revenue wallet" v={data.revenueWallet ? shortAddr(data.revenueWallet) : "–"} mono />
              <KeyVal k="Split" v={data.revenueBps == null ? "–" : `${data.revenueBps / 100}% studio · ${100 - data.revenueBps / 100}% pool`} />
              <KeyVal k="Floor allowance" v={`${(data.maxSlippageBps ?? 0) / 100}% under the peg`} />
              <KeyVal k="Floor for 1 USDC" v={data.floorPerUsdc ? `${wordWhole(data.floorPerUsdc)} $WORD` : "no peg: swaps wait"} />
              <KeyVal k="A sweep's size" v={usdc(data.maxSweepUsdc, testnet)} />
              <KeyVal k="Adapter" v={data.adapter ? shortAddr(data.adapter) : "–"} mono />
              <KeyVal k="Peg" v={data.pegSource ? `${shortAddr(data.pegSource)} at ${fmtUsdc(BigInt(data.pegPackUsdc ?? "0"))} USDC a pack` : "–"} />
              <KeyVal k="Paused" v={data.paused ? "yes" : "no"} />
            </div>
          </AdminCard>

          <AdminCard title="Sales per item">
            {(data.items ?? []).length === 0 ? (
              <p className="text-sm text-ink/60">The registry is empty.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-ink/55">
                      <th className="py-1 pr-3">#</th>
                      <th className="py-1 pr-3">Name</th>
                      <th className="py-1 pr-3">Price</th>
                      <th className="py-1 pr-3">Sold</th>
                      <th className="py-1 pr-3">Revenue</th>
                      <th className="py-1 pr-3">Window (UTC)</th>
                      <th className="py-1">On sale</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items!.map((it) => (
                      <tr key={it.id} className="border-t-2 border-ink/10">
                        <td className="py-1 pr-3 font-mono">{it.id}</td>
                        <td className="py-1 pr-3">{it.name ?? <span className="text-ink/45">no metadata{testnet ? " (Test item)" : ": hidden"}</span>}</td>
                        <td className="py-1 pr-3">{usdc(it.priceUsdc, testnet)}</td>
                        <td className="py-1 pr-3">
                          {it.sold}
                          {it.maxSupply ? ` / ${it.maxSupply}` : ""}
                        </td>
                        <td className="py-1 pr-3">{usdc(it.revenueUsdc, testnet)}</td>
                        <td className="py-1 pr-3">
                          {when(it.start)} → {it.end ? when(it.end) : "open"}
                        </td>
                        <td className="py-1">{it.active ? "yes" : "no"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </AdminCard>
        </>
      )}

      {groups.map(([group, fns]) => (
        <section key={`shop:${group}`} className="space-y-3">
          <SectionLabel>{group}</SectionLabel>
          {fns.map((fn) => (
            <OperationForm key={`shop:${fn.fn}`} contract={contract} fn={fn} address={address} chainId={d?.chainId ?? NETWORK.id} />
          ))}
        </section>
      ))}
    </div>
  );
}
