"use client";
/**
 * Persistent operator status strip (LHAW parity) — always-visible deployment + health state so the
 * operator knows, at a glance, whether they're acting on a live suite or building plans.
 */
import { SUITE_KEYS } from "@/lib/admin/deployments";
import { isAddress, shortAddr } from "@/lib/admin/format";
import { useDeployments } from "./useDeployments";
import { StatusBadge } from "./ui";
import { Cube, Key, Pulse, SealCheck } from "./icons";
import { NETWORK } from "@/lib/onchain/network";
import { isChainBacked } from "@/lib/onchain/gameMode";

export function StatusStrip() {
  const d = useDeployments();

  // Count only VALID addresses as deployed — consistent with the transaction builders / Access tab.
  const deployedCount = d ? SUITE_KEYS.filter((k) => isAddress(d.contracts[k] ?? "")).length : 0;
  const live = deployedCount === SUITE_KEYS.length;
  const phase: { tone: "ok" | "warning" | "error" | "accent"; label: string } = live
    ? { tone: "ok", label: "Suite live" }
    : deployedCount > 0
      ? { tone: "warning", label: `${deployedCount}/${SUITE_KEYS.length} deployed` }
      : { tone: "warning", label: "Not deployed" };

  return (
    <div className="cel mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl bg-paper-dark/60 px-4 py-2.5 text-xs">
      <span className="inline-flex items-center gap-1.5 font-bold">
        <Cube weight="fill" size={15} className="text-ink/60" />
        <StatusBadge tone={phase.tone}>{phase.label}</StatusBadge>
      </span>
      <span className="inline-flex items-center gap-1 text-ink/60">
        network <strong className="text-ink">{NETWORK.name} · {d?.chainId ?? NETWORK.id}</strong>
      </span>
      <span className="inline-flex items-center gap-1 font-mono text-ink/60">
        $WORD <strong className="text-ink">{shortAddr(d?.wordToken)}</strong>
      </span>
      <span className="inline-flex items-center gap-1 text-ink/60">
        <Key weight="bold" size={13} /> keeper{" "}
        <strong className="text-ink">{d?.roles.keeper ? shortAddr(d.roles.keeper) : "unset"}</strong>
      </span>
      <span className="inline-flex items-center gap-1 text-ink/60">
        <SealCheck weight="bold" size={13} /> signer{" "}
        <strong className="text-ink">{d?.roles.signer ? shortAddr(d.roles.signer) : "unset"}</strong>
      </span>
      <span className="ml-auto inline-flex items-center gap-1 text-ink/45">
        <Pulse weight="bold" size={13} />{" "}
        {/* What the GAME runs comes from the COMMITTED registry (gameMode.ts), while the badge counts
            this browser's registry too, which may hold pasted, uncommitted addresses (Bugbot on #166). */}
        {isChainBacked()
          ? `Game: chain, live on ${NETWORK.name}${NETWORK.isTestnet ? " (test $WORD)" : ""}`
          : live
            ? "Game: practice until these addresses are committed"
            : "Game: practice · no contracts on this network"}
      </span>
    </div>
  );
}
