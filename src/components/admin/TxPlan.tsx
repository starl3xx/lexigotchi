"use client";
/**
 * Transaction-plan UI — turns a registry function into an editable form and renders the resulting
 * `TxIntent` as a copy-pasteable `cast send` command + a Gnosis Safe batch, with a gated execute
 * affordance. This is the shared engine behind the Parameters, Keeper, Treasury, and Access tabs.
 *
 * In Phase 0 the contracts aren't deployed, so "execute" stays disabled — the cast command and Safe
 * JSON ARE the execution path (the owner runs them, ideally from the multisig). When the suite is
 * live and a wallet layer is added, the same TxIntent drives in-browser signing.
 */
import { useMemo, useState } from "react";
import type { ContractDef, ContractFn } from "@/lib/admin/contracts";
import {
  castCommand,
  safeBatchJson,
  validateIntent,
  type TxArgValue,
  type TxIntent,
} from "@/lib/admin/tx";
import { usdToWordWei } from "@/lib/admin/format";
import { Banner, CopyButton, Field, StatusBadge, TextField, Toggle } from "./ui";
import { CaretDown, Lock, Warning } from "./icons";

export function buildIntent(
  contract: ContractDef,
  fn: ContractFn,
  address: string | null | undefined,
  values: Record<string, string>,
): TxIntent {
  const args: TxArgValue[] = fn.args.map((a) => {
    if (a.type.startsWith("(") && a.components) {
      const vals = a.components.map((c) => (values[`${a.name}.${c.name}`] ?? "").trim());
      return { name: a.name, type: a.type, value: `(${vals.join(",")})`, components: a.components };
    }
    return { name: a.name, type: a.type, value: (values[a.name] ?? "").trim() };
  });
  return {
    contractKey: contract.key,
    contractName: contract.name,
    address: address ?? null,
    signature: fn.signature,
    fn: fn.fn,
    args,
  };
}

function initialValues(fn: ContractFn): Record<string, string> {
  const v: Record<string, string> = {};
  for (const a of fn.args) {
    if (a.type.startsWith("(") && a.components) {
      for (const c of a.components) v[`${a.name}.${c.name}`] = "";
    } else {
      v[a.name] = a.default ?? "";
    }
  }
  return v;
}

const usdHelpable = (type: string, name: string) =>
  type === "uint256" && /price|fee|cost|snack|amount/i.test(name);

/** Renders the cast command + Safe batch + execute gate for a built intent. */
export function TxOutput({ intent }: { intent: TxIntent }) {
  const [showSafe, setShowSafe] = useState(false);
  const errs = validateIntent(intent);
  const ready = errs.length === 0;
  const cast = ready ? castCommand(intent) : "";
  const safe = ready ? safeBatchJson([intent], { name: `${intent.contractName}.${intent.fn}` }) : "";

  return (
    <div className="mt-3 space-y-2">
      {!ready && (
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          {errs.join(" · ")}
        </Banner>
      )}
      {ready && (
        <>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink/45">cast send</span>
              <CopyButton text={cast} small />
            </div>
            <pre className="overflow-x-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-2.5 font-mono text-[11px] leading-relaxed text-ink/85">
              {cast}
            </pre>
          </div>
          <div>
            <button
              onClick={() => setShowSafe((s) => !s)}
              className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-ink/45"
            >
              <CaretDown weight="bold" size={12} className={showSafe ? "rotate-180" : ""} /> Safe transaction builder JSON
            </button>
            {showSafe && (
              <div className="mt-1">
                <div className="mb-1 flex justify-end">
                  <CopyButton text={safe} small label="Copy JSON" />
                </div>
                <pre className="max-h-60 overflow-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-2.5 font-mono text-[10px] leading-relaxed text-ink/75">
                  {safe}
                </pre>
              </div>
            )}
          </div>
        </>
      )}
      <div className="flex items-center gap-2 pt-1">
        <button
          disabled
          title="Available once the suite is deployed and a wallet is connected"
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-xl border-[3px] border-ink/40 bg-paper px-3 py-1.5 text-xs font-extrabold text-ink/40"
        >
          <Lock weight="bold" size={13} /> Execute in wallet
        </button>
        <span className="text-[11px] text-ink/45">
          {intent.address
            ? "live once a wallet layer is wired"
            : "set the address in Deployments to target a live contract"}
        </span>
      </div>
    </div>
  );
}

/**
 * Editable operation form for one registry function. Renders the right control per argument type,
 * builds the TxIntent live, and shows the cast/Safe output.
 */
export function OperationForm({
  contract,
  fn,
  address,
  prefill,
}: {
  contract: ContractDef;
  fn: ContractFn;
  address?: string | null;
  prefill?: Record<string, string>;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => ({
    ...initialValues(fn),
    ...(prefill ?? {}),
  }));
  const set = (k: string, v: string) => setValues((p) => ({ ...p, [k]: v }));
  const intent = useMemo(() => buildIntent(contract, fn, address, values), [contract, fn, address, values]);
  const errsByArg = useMemo(() => {
    const e = new Set(validateIntent(intent).map((m) => m.split(" ")[0]));
    return e;
  }, [intent]);

  return (
    <div className="cel rounded-2xl bg-paper p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h4 className="font-display text-sm font-extrabold">{fn.title}</h4>
            {fn.danger && <StatusBadge tone="error">sensitive</StatusBadge>}
            {fn.kind === "keeper" && <StatusBadge tone="accent">keeper</StatusBadge>}
          </div>
          <p className="mt-0.5 max-w-prose text-xs text-ink/60">{fn.desc}</p>
        </div>
        <code className="shrink-0 rounded bg-ink/[0.05] px-1.5 py-0.5 font-mono text-[10px] text-ink/55">
          {fn.fn}
        </code>
      </div>

      {fn.args.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {fn.args.map((a) => {
            if (a.type === "bool") {
              return (
                <Field key={a.name} label={a.name} hint={a.help}>
                  <Toggle
                    checked={values[a.name] === "true"}
                    onChange={(v) => set(a.name, v ? "true" : "false")}
                    label={values[a.name] === "true" ? "true" : "false"}
                  />
                </Field>
              );
            }
            if (a.type.startsWith("(") && a.components) {
              return (
                <div key={a.name} className="sm:col-span-2">
                  <div className="mb-1 text-xs font-bold text-ink/70">
                    {a.name} <span className="text-[10px] font-normal text-ink/45">({a.help})</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {a.components.map((c) => (
                      <Field key={c.name} label={c.name}>
                        <TextField
                          value={values[`${a.name}.${c.name}`] ?? ""}
                          onChange={(e) => set(`${a.name}.${c.name}`, e.target.value)}
                          placeholder="bps"
                          inputMode="numeric"
                        />
                      </Field>
                    ))}
                  </div>
                </div>
              );
            }
            return (
              <Field key={a.name} label={a.name} hint={a.help ? `${a.type} · ${a.help}` : a.type}>
                <TextField
                  value={values[a.name] ?? ""}
                  onChange={(e) => set(a.name, e.target.value)}
                  placeholder={a.type}
                  invalid={errsByArg.has(a.name)}
                />
                {usdHelpable(a.type, a.name) && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <span className="text-[10px] text-ink/45">from USD $</span>
                    <input
                      type="number"
                      step="0.01"
                      placeholder="0.25"
                      onChange={(e) => {
                        const usd = Number(e.target.value);
                        if (Number.isFinite(usd) && usd > 0) set(a.name, usdToWordWei(usd));
                      }}
                      className="w-20 rounded-lg border-2 border-ink/40 bg-paper px-2 py-0.5 text-[11px]"
                    />
                    <span className="text-[10px] text-ink/40">→ fills wei at the current peg</span>
                  </div>
                )}
              </Field>
            );
          })}
        </div>
      )}

      <TxOutput intent={intent} />
    </div>
  );
}
