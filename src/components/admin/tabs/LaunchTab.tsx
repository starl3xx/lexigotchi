"use client";
/**
 * Launch — the contract deployment console. Deployment is a single `forge script Deploy` run (it
 * deploys + wires all 10 contracts and seeds the v0.2 fee splits), driven by env vars. This tab
 * collects those vars, generates the exact command + export block, and walks the deploy order,
 * wiring, and post-launch checklist. Executes nothing here — you run forge with your deployer key.
 */
import { useState } from "react";
import { CONTRACTS } from "@/lib/admin/contracts";
import { isAddress, isBytes32 } from "@/lib/admin/format";
import economy from "../../../../contracts/config/economy.json";
import { AdminCard, Banner, CopyButton, Field, SectionLabel, TextField } from "../ui";
import { Info, ListChecks, RocketLaunch } from "../icons";

interface EnvField {
  key: string;
  label: string;
  required?: boolean;
  type?: "address" | "bytes32" | "text";
  default?: string;
  help?: string;
}

const ENV: EnvField[] = [
  { key: "BASE_RPC", label: "Base RPC URL", required: true, type: "text", help: "your Base mainnet RPC endpoint" },
  { key: "TREASURY", label: "Treasury", required: true, type: "address", help: "treasury address (the owner wallet)" },
  { key: "SIGNER", label: "Signer", required: true, type: "address", help: "backend key (draws / rolls / prestige)" },
  { key: "KEEPER", label: "Keeper", required: true, type: "address", help: "operator key (resolve / epochs)" },
  { key: "ANSWERCHAIN_HEAD", label: "AnswerChain head", required: true, type: "bytes32", help: "precomputed reverse hash-chain head" },
  { key: "WORD_TOKEN", label: "$WORD token", type: "address", default: "0x304e649e69979298bd1aee63e175adf07885fb4b" },
  { key: "SWAP_ROUTER", label: "Swap router (optional)", type: "address", help: "ETH→$WORD adapter; blank = disabled" },
  { key: "BOUNTY_CARVE_BPS", label: "Bounty carve (bps)", type: "text", default: "0", help: "0 = bounty off" },
  { key: "PRESTIGE_MAX_LEVEL", label: "Prestige max level", type: "text", default: "4" },
  { key: "LETTERS_URI", label: "Letters metadata URI", type: "text", help: "ERC-1155 URI (optional)" },
];

export function LaunchTab() {
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(ENV.map((f) => [f.key, f.default ?? ""])),
  );
  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));

  const invalid = (f: EnvField) => {
    const v = (vals[f.key] ?? "").trim();
    if (v === "") return false;
    if (f.type === "address") return !isAddress(v);
    if (f.type === "bytes32") return !isBytes32(v);
    return false;
  };
  const missing = ENV.filter((f) => f.required && !(vals[f.key] ?? "").trim());

  const exportBlock = ENV.filter((f) => (vals[f.key] ?? "").trim() !== "")
    // Single-quote (with the '\'' escape) so a quote, $, backtick, or space in a value can't
    // split the shell string when the block is pasted.
    .map((f) => `export ${f.key}='${vals[f.key].trim().replace(/'/g, "'\\''")}'`)
    .join("\n");
  const command = [
    "# 0 · regenerate the on-chain economy config (caps + dictionary root) — run from the repo root",
    "npm run derive:contracts",
    "npm run contracts:setup   # one-time: vendor forge-std + OpenZeppelin",
    "",
    "# 1 · env",
    exportBlock || "# (fill the required fields above)",
    "",
    "# 2 · deploy + wire all 10 contracts, seed the v0.2 splits (forge runs from contracts/)",
    'cd contracts && forge script script/Deploy.s.sol:Deploy --rpc-url "$BASE_RPC" --broadcast --verify',
  ].join("\n");

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <RocketLaunch weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Launch</h2>
      </div>

      <Banner tone="warning" icon={<Info weight="bold" size={14} />}>
        The suite is <strong>code-complete and tested but not yet audited or deployed</strong>. Deployment is one
        <code> forge script</code> run from your deployer key — this console assembles its inputs and walks the steps.
      </Banner>

      <AdminCard title="Deploy configuration">
        <div className="grid gap-3 sm:grid-cols-2">
          {ENV.map((f) => (
            <Field key={f.key} label={<>{f.label}{f.required && <span className="text-candy"> *</span>}</>} hint={f.help}>
              <TextField value={vals[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)} placeholder={f.type ?? "value"} invalid={invalid(f)} />
            </Field>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-ink/45">
          Per-letter caps ({economy.caps.length} ids, {economy.totalSupplyCap.toLocaleString()} total) and the
          dictionary root (<span className="font-mono">{economy.dictionaryRoot.slice(0, 12)}…</span>) are read from{" "}
          <code>config/economy.json</code> by the script — not env.
        </p>
      </AdminCard>

      <AdminCard
        title="Deploy command"
        action={<CopyButton text={command} label="Copy" />}
      >
        {missing.length > 0 && (
          <Banner tone="warning">Fill required fields: {missing.map((f) => f.label).join(", ")}</Banner>
        )}
        <pre className="mt-2 overflow-x-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-3 font-mono text-[11px] leading-relaxed text-ink/85">
          {command}
        </pre>
      </AdminCard>

      <AdminCard title="Deploy order">
        <SectionLabel>10 contracts, in dependency order — constructor inputs</SectionLabel>
        <ol className="space-y-2">
          {[...CONTRACTS].sort((a, b) => a.order - b.order).map((c) => (
            <li key={c.key} className="border-t-2 border-ink/10 pt-2 first:border-0 first:pt-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-ink/40">{c.order}</span>
                <span className="font-display text-sm font-extrabold">{c.name}</span>
              </div>
              <p className="text-xs text-ink/55">{c.purpose}</p>
              <p className="mt-0.5 font-mono text-[10px] text-ink/45">{c.ctor.map((a) => `${a.type} ${a.name}`).join(", ")}</p>
            </li>
          ))}
        </ol>
      </AdminCard>

      <AdminCard title="After launch">
        <ul className="space-y-1.5 text-sm text-ink/75">
          {[
            "Copy the 10 printed addresses into the Deployments tab (and commit config/deployments.json).",
            "Verify the wiring checklist (Access & Safety tab).",
            "Transfer ownership of all 10 contracts to the owner key (a hardware wallet), then accept (Access & Safety).",
            "Confirm the keeper + signer are the production keys; pre-commit the AnswerChain head.",
            "Seed the Rewards Pool if bootstrapping early yield (Treasury & Pools).",
          ].map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <ListChecks weight="bold" size={15} className="mt-0.5 shrink-0 text-teal" /> {s}
            </li>
          ))}
        </ul>
      </AdminCard>
    </div>
  );
}
