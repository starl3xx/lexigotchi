"use client";
/**
 * Keeper — the recurring operator duties (run from the keeper key, NOT the owner key): resolve the
 * daily jackpot, open yield epochs, open bounty periods. The cron runs them by itself every day; the
 * forms here are the by-hand fallback. Plus a reference for the server's signing and relaying
 * duties (draws, roll and prestige outcomes, daily vouchers, finishing rolls). Live status of the
 * keys and the last resolve is on the System tab.
 */
import { keeperFns } from "@/lib/admin/contracts";
import { shortAddr } from "@/lib/admin/format";
import { useDeployments } from "../useDeployments";
import { AdminCard, Banner, KeyVal, SectionLabel } from "../ui";
import { OperationForm } from "../TxPlan";
import { Info, Key, Wrench } from "../icons";
import { NETWORK } from "@/lib/onchain/network";

const SIGNER_DUTIES = [
  ["Letter draws", "Draw a fair, demand-mirrored letter set under the per-letter caps, then sign the reveal so Letters.reveal can mint. The first draw for a commit is kept (letter_draws), so a commit never has two valid draws."],
  ["Roll outcomes", "Decide each roll's success on the pity-adjusted odds and sign it. The server's relayer key then sends Rolls.reveal itself, so the wallet never previews the result."],
  ["Prestige outcomes", "Decide each ascension attempt and sign so Prestige.reveal can bump the level (re-validated on-chain)."],
  ["Daily letter", "Check the player's identity (a Farcaster FID, an X account older than 90 days, or a Coinbase-verified wallet), refuse if any of them took today's letter, then sign the free daily voucher."],
];

export function KeeperTab() {
  const d = useDeployments();
  const duties = keeperFns();

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Wrench weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Keeper duties</h2>
      </div>

      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        These run by themselves: <code>/api/cron/keeper</code> at 00:05 UTC (vercel.json), the jobs in <code>KEEPER_JOBS</code>, one at
        a time. The forms below are for running one by hand. The System tab shows the keys, their gas, and whether today&apos;s
        jackpot resolved.
      </Banner>

      <Banner tone="warning" icon={<Key weight="bold" size={14} />}>
        These run from the <strong>keeper</strong> key (the operator hot key:{" "}
        <span className="font-mono">{shortAddr(d?.roles.keeper)}</span>), not the owner key (a hardware wallet). Rotate the keeper in
        Parameters to pause a duty in an emergency.
      </Banner>

      {duties.map(({ contract, fn }) => (
        <section key={`${contract.key}.${fn.fn}`} className="space-y-2">
          <SectionLabel>
            {contract.name} · {fn.group}
          </SectionLabel>
          <OperationForm contract={contract} fn={fn} address={d?.contracts[contract.key] ?? null} chainId={d?.chainId ?? NETWORK.id} />
        </section>
      ))}

      <AdminCard title="Daily jackpot — chain pre-commit">
        <p className="text-sm text-ink/70">
          Jackpot.resolve consumes the AnswerChain one word per day, atomically. The operator pre-computes the{" "}
          <strong>reverse hash-chain</strong> off-chain and commits its head once (AnswerChain.setHead, in
          Parameters). Each day you reveal the next word + salt + the following commit. The sequence can&apos;t be
          steered — not even by the team.
        </p>
      </AdminCard>

      <AdminCard title="Server duties (signed or sent by the server, not from here)">
        <p className="mb-2 text-xs text-ink/60">
          The backend signer (<span className="font-mono">{shortAddr(d?.roles.signer)}</span>) signs these so the
          on-chain reveal functions can verify them. Only roll reveals are sent by the server (the relayer key).
        </p>
        {SIGNER_DUTIES.map(([k, v]) => (
          <KeyVal key={k} k={<span className="font-bold">{k}</span>} v={<span className="max-w-[60%] text-right text-xs font-normal text-ink/60">{v}</span>} />
        ))}
        <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
          <span className="text-xs">Merkle roots for yield epochs / bounty periods are also computed off-chain, then posted with the openEpoch duties above.</span>
        </Banner>
      </AdminCard>
    </div>
  );
}
