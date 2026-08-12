"use client";
/**
 * Treasury & Pools — bucket levels and the reward-pool funding builder. Seeding uses the owner-only
 * FeeRouter.seed(bucket, amount) (added to enable this feature): approve $WORD to the FeeRouter,
 * then credit the Pool or Bounty bucket. The jackpot is deliberately not seedable — an
 * operator-funded chance pot is the core lottery risk (see params.ts), so it self-funds from fees.
 */
import { useMemo, useState } from "react";
import type { PulsePayload } from "@/lib/admin/metrics";
import { SEED_BUCKETS } from "@/lib/admin/contracts";
import type { Deployments } from "@/lib/admin/deployments";
import { useDeployments } from "../useDeployments";
import { castCommand, safeBatchJson, validateIntent, type TxIntent } from "@/lib/admin/tx";
import { fmtUsd, fmtWordCompact, isAddress, shortAddr, usdToWordWei, WEI } from "@/lib/admin/format";
import { AdminCard, Banner, CopyButton, ErrorState, Field, KeyVal, MetricCard, SectionLabel, Select, Spinner, TextField, useFetch } from "../ui";
import { Coins, Info, Lock, Trophy, Wallet, Warning } from "../icons";
import { NETWORK } from "@/lib/onchain/network";

export function TreasuryTab() {
  const { data, loading, error, reload } = useFetch<PulsePayload>("/api/admin/pulse");
  const d = useDeployments();

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorState msg={error} onRetry={reload} />;
  const h = data?.headline;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Wallet weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Treasury &amp; Pools</h2>
      </div>

      <section>
        <SectionLabel>Bucket levels · projected (sim) until the suite is live</SectionLabel>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <MetricCard icon={<Coins weight="bold" size={14} />} label="Rewards Pool" tone="accent" value={h ? fmtUsd(h.pool) : "—"} sub="funds UPPERCASE yield" series={data?.series.pool} />
          <MetricCard icon={<Trophy weight="bold" size={14} />} label="Jackpot" tone="warning" value={h ? fmtUsd(h.jackpot) : "—"} sub="self-funded from fees" series={data?.series.jackpot} />
          <MetricCard icon={<Coins weight="bold" size={14} />} label="Bounty Pool" value={h ? fmtUsd(h.bountyPool) : "—"} sub="carve off by default · seed to fund" series={data?.series.bounty} />
          <MetricCard icon={<Wallet weight="bold" size={14} />} label="Treasury (cum.)" value={h ? fmtUsd(h.treasury) : "—"} sub="leaves to the owner wallet per fee" series={data?.series.treasury} />
        </div>
      </section>

      <FundingCard deployments={d} />

      <AdminCard title="Where the treasury balance lives">
        <p className="text-sm text-ink/70">
          There&apos;s no treasury &quot;withdraw&quot; — the treasury share of every fee is forwarded straight to the
          treasury address — the owner wallet (<span className="font-mono text-xs">{shortAddr(d?.roles.treasury)}</span>) the moment
          it&apos;s routed. So the treasury balance is simply that wallet&apos;s $WORD. Snacks are 100% burned;
          royalties route 100% to treasury.
        </p>
      </AdminCard>
    </div>
  );
}

function FundingCard({ deployments }: { deployments: Deployments | null }) {
  const [bucket, setBucket] = useState(String(SEED_BUCKETS[0].id));
  const [usd, setUsd] = useState("100");
  const [wei, setWei] = useState(usdToWordWei(100));

  const feeRouter = deployments?.contracts.feeRouter ?? null;
  const wordToken = deployments?.wordToken ?? null;
  const bucketDef = SEED_BUCKETS.find((b) => String(b.id) === bucket)!;
  const wordAmount = useMemo(() => (wei && /^\d+$/.test(wei) ? Number(BigInt(wei) / WEI) : 0), [wei]);

  const intents: TxIntent[] = [
    {
      contractKey: "word",
      contractName: "$WORD",
      address: wordToken,
      signature: "approve(address,uint256)",
      fn: "approve",
      args: [
        { name: "spender", type: "address", value: feeRouter ?? "" },
        { name: "amount", type: "uint256", value: wei },
      ],
    },
    {
      contractKey: "feeRouter",
      contractName: "FeeRouter",
      address: feeRouter,
      signature: "seed(uint8,uint256)",
      fn: "seed",
      args: [
        { name: "bucket", type: "uint8", value: bucket },
        { name: "amount", type: "uint256", value: wei },
      ],
    },
  ];

  const usdNum = Number(usd);
  const usdInvalid = usd.trim() !== "" && (!Number.isFinite(usdNum) || usdNum <= 0 || usdNum > 1e9);
  const onUsd = (v: string) => {
    setUsd(v);
    const n = Number(v);
    if (Number.isFinite(n) && n > 0 && n <= 1e9) setWei(usdToWordWei(n));
  };

  // Gate the rendered transactions exactly like TxOutput: a missing/empty FeeRouter or $WORD
  // address, or a bad amount, must not produce a copy-paste cast / Safe batch that looks ready.
  const fundErrs = [...new Set([...validateIntent(intents[0]), ...validateIntent(intents[1])])];
  const addrsOk = isAddress(feeRouter ?? "") && isAddress(wordToken ?? "");
  const ready = fundErrs.length === 0 && addrsOk;

  return (
    <AdminCard title="Add $WORD to a reward pool">
      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        <span className="text-xs">
          Owner action. Two transactions: <strong>approve</strong> the FeeRouter to pull your $WORD, then{" "}
          <strong>seed</strong> the bucket. Run from the owner wallet (a hardware wallet).
        </span>
      </Banner>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Bucket">
          <Select value={bucket} onChange={setBucket} options={SEED_BUCKETS.map((b) => ({ value: String(b.id), label: b.label }))} />
        </Field>
        <Field label="Amount (USD target)" hint="re-pegs to $WORD">
          <TextField type="number" value={usd} onChange={(e) => onUsd(e.target.value)} invalid={usdInvalid} />
        </Field>
        <Field label="$WORD (wei)" hint={`≈ ${fmtWordCompact(wordAmount)} $WORD`}>
          <TextField value={wei} onChange={(e) => setWei(e.target.value)} />
        </Field>
      </div>
      <p className="mt-1 text-[11px] text-ink/45">
        Seeding <strong>{bucketDef.label}</strong> — {bucketDef.desc}. ≈ {fmtWordCompact(wordAmount)} $WORD (from the amount above).
      </p>

      {ready ? (
        <div className="mt-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-ink/45">cast (2 steps)</span>
            <CopyButton small label="Copy Safe batch (optional)" text={safeBatchJson(intents, { name: `Seed ${bucketDef.label} with $WORD` }, deployments?.chainId ?? NETWORK.id)} />
          </div>
          <pre className="overflow-x-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-2.5 font-mono text-[11px] leading-relaxed text-ink/85">
            {`# 1 · approve\n${castCommand(intents[0])}\n\n# 2 · seed ${bucketDef.label}\n${castCommand(intents[1])}`}
          </pre>
        </div>
      ) : (
        <div className="mt-3">
          <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
            {!addrsOk
              ? "Set valid FeeRouter and $WORD token addresses in Deployments to build the funding transactions."
              : fundErrs.join(" · ")}
          </Banner>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button disabled className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border-[3px] border-ink/40 bg-paper px-3 py-1.5 text-xs font-extrabold text-ink/40">
          <Lock weight="bold" size={13} /> Execute in wallet
        </button>
        <span className="text-[11px] text-ink/45">{feeRouter ? "live once a wallet layer is wired" : "set the FeeRouter address in Deployments"}</span>
      </div>
    </AdminCard>
  );
}
