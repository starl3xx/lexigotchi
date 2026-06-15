"use client";
/**
 * Deployments — the address registry. Paste the addresses printed by `forge script Deploy` to light
 * up live operations across the dashboard. Saved in the browser for this session; export the JSON
 * and commit it to config/deployments.json to make it permanent.
 */
import { useEffect, useRef, useState } from "react";
import {
  CONTRACT_KEYS,
  ROLE_KEYS,
  loadDeployments,
  saveDeployments,
  clearDeployments,
  BASE_DEPLOYMENTS,
  type Deployments,
  type ContractKey,
  type RoleKey,
} from "@/lib/admin/deployments";
import { CONTRACT_BY_KEY } from "@/lib/admin/contracts";
import { basescanAddress, isAddress } from "@/lib/admin/format";
import { AdminCard, Banner, CopyButton, Field, SectionLabel, TextField } from "../ui";
import { ArrowRight, Database, Info } from "../icons";

export function DeploymentsTab() {
  const [draft, setDraft] = useState<Deployments>(BASE_DEPLOYMENTS);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => setDraft(loadDeployments()), []);
  useEffect(() => () => clearTimeout(savedTimer.current), []);

  const setContract = (k: ContractKey, v: string) =>
    setDraft((p) => ({ ...p, contracts: { ...p.contracts, [k]: v.trim() || null } }));
  const setRole = (k: RoleKey, v: string) => setDraft((p) => ({ ...p, roles: { ...p.roles, [k]: v.trim() || null } }));

  const persist = () => {
    saveDeployments(draft);
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 1500);
    window.dispatchEvent(new Event("lexi:deployments"));
  };
  const reset = () => {
    clearDeployments();
    setDraft(BASE_DEPLOYMENTS);
    window.dispatchEvent(new Event("lexi:deployments"));
  };

  const exportJson = JSON.stringify(
    { network: draft.network, chainId: draft.chainId, deployedAt: draft.deployedAt, wordToken: draft.wordToken, roles: draft.roles, contracts: draft.contracts },
    null,
    2,
  );

  const invalid = (v: string | null) => !!v && !isAddress(v);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Database weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Deployments</h2>
      </div>

      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        <span className="text-xs">
          Saved in this browser for the session. To make it permanent, copy the JSON below into{" "}
          <code>config/deployments.json</code> and commit.
        </span>
      </Banner>

      <AdminCard title="Contract addresses">
        <div className="grid gap-3 sm:grid-cols-2">
          {CONTRACT_KEYS.map((k) => {
            const addr = draft.contracts[k];
            return (
              <Field key={k} label={CONTRACT_BY_KEY[k].name} hint={addr && isAddress(addr) ? <a href={basescanAddress(addr)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-teal underline">Basescan <ArrowRight size={10} /></a> : undefined}>
                <TextField value={addr ?? ""} onChange={(e) => setContract(k, e.target.value)} placeholder="0x…" invalid={invalid(addr)} />
              </Field>
            );
          })}
        </div>
      </AdminCard>

      <AdminCard title="Roles & token">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="$WORD token">
            <TextField value={draft.wordToken} onChange={(e) => setDraft((p) => ({ ...p, wordToken: e.target.value.trim() }))} invalid={invalid(draft.wordToken)} />
          </Field>
          {ROLE_KEYS.map((k) => (
            <Field key={k} label={k}>
              <TextField value={draft.roles[k] ?? ""} onChange={(e) => setRole(k, e.target.value)} placeholder="0x…" invalid={invalid(draft.roles[k])} />
            </Field>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button onClick={persist} className="rounded-xl border-[3px] border-ink bg-candy px-4 py-2 text-sm font-extrabold text-paper shadow-[3px_3px_0_#1b1714] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none">
            {saved ? "Saved ✓" : "Save to browser"}
          </button>
          <button onClick={reset} className="text-xs font-bold text-ink/50">Reset to committed</button>
        </div>
      </AdminCard>

      <AdminCard title="config/deployments.json" action={<CopyButton text={exportJson} label="Copy JSON" />}>
        <SectionLabel>commit this to make the registry permanent</SectionLabel>
        <pre className="max-h-72 overflow-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-3 font-mono text-[10px] leading-relaxed text-ink/75">
          {exportJson}
        </pre>
      </AdminCard>
    </div>
  );
}
