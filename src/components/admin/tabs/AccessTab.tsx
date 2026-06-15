"use client";
/**
 * Access & Safety — ownership handoff to the multisig (Ownable2Step, batched across all 10
 * contracts), the deploy-time wiring checklist, role addresses, and an honest account of the
 * emergency levers the suite actually has (there is no global pause — see the card).
 */
import { useMemo, useState } from "react";
import { CONTRACTS } from "@/lib/admin/contracts";
import type { TxIntent } from "@/lib/admin/tx";
import { castCommand, safeBatchJson } from "@/lib/admin/tx";
import { isAddress, shortAddr } from "@/lib/admin/format";
import { useDeployments } from "../useDeployments";
import { AdminCard, Banner, ConfirmButton, CopyButton, Field, KeyVal, SectionLabel, TextField } from "../ui";
import { Info, ShieldCheck, Warning } from "../icons";

const WIRING = [
  "FeeRouter.setCollector(Letters / Words / Rolls / Staking / Prestige, true)",
  "FeeRouter.setPayers(YieldDistributor, Jackpot, Bounty)",
  "FeeRouter.setSplit(× all 7 fee sources)",
  "Letters.setUpgrader(Rolls, true) · Letters.setUpgrader(Words, true)",
  "Words.setRolls(Rolls) · Words.setPrestige(Prestige)",
  "Rolls.setStaking(Staking)",
  "AnswerChain.setKeeper(Jackpot)",
];

const LEVERS = [
  ["Halt rolls / prestige / draws", "Rotate the signer to a dead key (Letters/Rolls/Prestige.setSigner). Reveals can no longer be produced, so no value-bearing outcome resolves."],
  ["Pause the daily jackpot", "Rotate the Jackpot keeper (Jackpot.setKeeper) — resolve() can't be called."],
  ["Pause yield / bounty payouts", "Rotate the YieldDistributor / Bounty keeper, or simply stop opening epochs. Buckets keep accruing safely."],
  ["Freeze the answer sequence", "AnswerChain.setHead is only allowed before the chain starts or once exhausted — it can never be rewritten mid-stream."],
];

export function AccessTab() {
  const d = useDeployments();
  const [multisig, setMultisig] = useState("");
  const [revealed, setRevealed] = useState(false);

  const valid = isAddress(multisig);
  const missing = CONTRACTS.filter((c) => !isAddress(d?.contracts[c.key] ?? "")).map((c) => c.name);
  const deployedAll = missing.length === 0;
  const transferIntents: TxIntent[] = useMemo(
    () =>
      CONTRACTS.map((c) => ({
        contractKey: c.key,
        contractName: c.name,
        address: d?.contracts[c.key] ?? null,
        signature: "transferOwnership(address)",
        fn: "transferOwnership",
        args: [{ name: "newOwner", type: "address", value: multisig.trim() }],
      })),
    [d, multisig],
  );
  const acceptIntents: TxIntent[] = useMemo(
    () =>
      CONTRACTS.map((c) => ({
        contractKey: c.key,
        contractName: c.name,
        address: d?.contracts[c.key] ?? null,
        signature: "acceptOwnership()",
        fn: "acceptOwnership",
        args: [],
      })),
    [d],
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <ShieldCheck weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Access &amp; Safety</h2>
      </div>

      <AdminCard title="Hand ownership to the multisig">
        <p className="mb-3 text-sm text-ink/65">
          Ownable2Step, two phases. First the deployer transfers all 10 contracts to the multisig; then the multisig
          accepts. Paste the multisig to generate both Safe batches.
        </p>
        <Field label="Multisig address" hint="the Safe that will own the suite">
          <TextField value={multisig} onChange={(e) => setMultisig(e.target.value)} placeholder="0x…" invalid={multisig !== "" && !valid} />
        </Field>

        {valid && !deployedAll && (
          <div className="mt-3">
            <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
              No deployed address yet for: {missing.join(", ")}. Set them in the Deployments tab before generating the
              ownership handoff — otherwise the batch would target placeholders.
            </Banner>
          </div>
        )}

        {valid && deployedAll && !revealed && (
          <div className="mt-4 space-y-2">
            <Banner tone="error" icon={<Warning weight="bold" size={14} />}>
              Sensitive — this hands ownership of all {CONTRACTS.length} contracts to the multisig. Double-check the
              address, then type <code>transferOwnership</code> to reveal the batch.
            </Banner>
            <ConfirmButton phrase="transferOwnership" onConfirm={() => setRevealed(true)}>
              Reveal ownership handoff
            </ConfirmButton>
          </div>
        )}

        {valid && deployedAll && revealed && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink/45">1 · Transfer all → multisig (run from deployer)</span>
                <CopyButton small label="Copy Safe batch" text={safeBatchJson(transferIntents, { name: "Lexigotchi — transfer ownership to multisig" }, d?.chainId ?? 8453)} />
              </div>
              <pre className="max-h-40 overflow-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-2.5 font-mono text-[10px] leading-relaxed text-ink/75">
                {transferIntents.map((i) => castCommand(i)).join("\n\n")}
              </pre>
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wide text-ink/45">2 · Accept all (run from the multisig)</span>
                <CopyButton small label="Copy Safe batch" text={safeBatchJson(acceptIntents, { name: "Lexigotchi — accept ownership" }, d?.chainId ?? 8453)} />
              </div>
              <pre className="max-h-40 overflow-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-2.5 font-mono text-[10px] leading-relaxed text-ink/75">
                {acceptIntents.map((i) => castCommand(i)).join("\n\n")}
              </pre>
            </div>
          </div>
        )}
      </AdminCard>

      <AdminCard title="Roles">
        <KeyVal k="Owner" v={<span className="font-mono text-xs">{shortAddr(d?.roles.owner)}</span>} />
        <KeyVal k="Treasury" v={<span className="font-mono text-xs">{shortAddr(d?.roles.treasury)}</span>} />
        <KeyVal k="Keeper" v={<span className="font-mono text-xs">{shortAddr(d?.roles.keeper)}</span>} />
        <KeyVal k="Signer" v={<span className="font-mono text-xs">{shortAddr(d?.roles.signer)}</span>} />
      </AdminCard>

      <AdminCard title="Deploy-time wiring">
        <SectionLabel>set automatically by the deploy script — verify after launch</SectionLabel>
        <ul className="space-y-1.5">
          {WIRING.map((w) => (
            <li key={w} className="flex items-start gap-2 text-sm text-ink/75">
              <span className="mt-0.5 text-teal">✓</span> <span className="font-mono text-xs">{w}</span>
            </li>
          ))}
        </ul>
      </AdminCard>

      <AdminCard title="Emergency levers">
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          <span className="text-xs">
            The suite has <strong>no global pause</strong> by design — solvency is structural, so funds can&apos;t be
            drained. The levers below halt specific flows by rotating the keys that drive them.
          </span>
        </Banner>
        <div className="mt-3 space-y-2">
          {LEVERS.map(([k, v]) => (
            <KeyVal key={k} k={<span className="font-bold">{k}</span>} v={<span className="max-w-[62%] text-right text-xs font-normal text-ink/60">{v}</span>} />
          ))}
        </div>
        <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
          <span className="text-xs">A failed roll never harms the asset, and the buckets can never pay more than they hold — so a paused flow is always safe to resume.</span>
        </Banner>
      </AdminCard>
    </div>
  );
}
