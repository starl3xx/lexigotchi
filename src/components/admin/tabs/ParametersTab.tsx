"use client";
/**
 * Parameters — every owner-only setter across the suite, grouped by contract, rendered as a
 * transaction builder. These are the multisig-tunable storage variables (prices, splits, care
 * thresholds, bounty carve, dictionary root, role rotations). Each form emits a cast command + Safe
 * batch; nothing executes from here in Phase 0.
 */
import { useMemo, useState } from "react";
import { CONTRACTS } from "@/lib/admin/contracts";
import { shortAddr } from "@/lib/admin/format";
import { useDeployments } from "../useDeployments";
import { AdminCard, Banner, SectionLabel } from "../ui";
import { OperationForm } from "../TxPlan";
import { Faders, Info } from "../icons";

export function ParametersTab() {
  const d = useDeployments();
  const [sel, setSel] = useState(CONTRACTS[0].key);

  const contract = CONTRACTS.find((c) => c.key === sel)!;
  const ownerFns = contract.fns.filter((f) => f.kind === "owner");
  const groups = useMemo(() => {
    const m = new Map<string, typeof ownerFns>();
    for (const f of ownerFns) {
      if (!m.has(f.group)) m.set(f.group, []);
      m.get(f.group)!.push(f);
    }
    return [...m.entries()];
  }, [ownerFns]);
  const address = d?.contracts[sel] ?? null;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Faders weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Parameters</h2>
      </div>

      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        These are <strong>owner</strong> actions — run them from the multisig that owns the suite. Each form builds the
        exact transaction; copy the <code>cast</code> command or the Safe batch.
      </Banner>

      <div className="flex flex-wrap gap-2">
        {CONTRACTS.map((c) => (
          <button
            key={c.key}
            onClick={() => setSel(c.key)}
            className={`rounded-lg border-2 border-ink px-2.5 py-1 text-xs font-bold active:translate-y-[1px] ${
              c.key === sel ? "bg-ink text-paper" : "bg-paper"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      <AdminCard>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display text-base font-extrabold">{contract.name}</h3>
            <p className="max-w-prose text-xs text-ink/60">{contract.purpose}</p>
          </div>
          <span className="font-mono text-[11px] text-ink/50">{address ? shortAddr(address) : "not deployed"}</span>
        </div>
      </AdminCard>

      {groups.map(([group, fns]) => (
        <section key={`${contract.key}:${group}`} className="space-y-3">
          <SectionLabel>{group}</SectionLabel>
          {fns.map((fn) => (
            // Key by contract too: function names repeat across contracts (setSigner, setKeeper,
            // transferOwnership…), and an fn-only key would reuse a form instance — and its stale
            // inputs / revealed-danger state — when switching contracts.
            <OperationForm key={`${contract.key}:${fn.fn}`} contract={contract} fn={fn} address={address} chainId={d?.chainId ?? 8453} />
          ))}
        </section>
      ))}
    </div>
  );
}
