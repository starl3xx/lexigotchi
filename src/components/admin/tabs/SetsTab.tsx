"use client";
/**
 * Sets — reserved word sets (decisions.md, "Reserved word sets"): themed groups of dictionary words
 * held back from the game and released later.
 *
 * A word is held back by being left OUT of the root `Words.claim` checks, so two things move apart
 * here and this tab shows both: the SETS (this database: edit them freely while they are drafts),
 * and the CHAIN's root (which changes only when the owner sends a transaction). "Root out of date"
 * means the sets hold back words the chain still lets through; nothing breaks meanwhile, because
 * proofs always come from the tree the chain holds.
 *
 * A COLLAB set (decisions.md, "Collab sets") is one made with a partner: exactly five words, a
 * partner's name and link, two card colors, and a stamp. All of it is a draft's to edit and locked
 * at the reveal, like the name. A set's FIRST DAY can be open to every verified player (the
 * default), to the wallets on a list pasted here, or to holders of a token on Base; that rule can
 * change until the release.
 *
 * Gated on the server (useAdminApi): this is the only place a draft set's name and words are shown.
 * The repository is public, so never paste a list into an issue, a PR, or a commit.
 */
import { useMemo, useState } from "react";
import type { AdminSet, AdminSetsPayload } from "@/app/api/admin/sets/route";
import type { ReleasePlan, ReservePlan } from "@/lib/sets/server";
import { castCommand, safeBatchJson, type TxIntent } from "@/lib/admin/tx";
import { NETWORK } from "@/lib/onchain/network";
import { COLLAB_WORDS, STAMP_MAX_BYTES, STAMP_TYPES } from "@/lib/sets/rules";
import { useAdminApi, type AdminSendError } from "../useAdminApi";
import { GatedState } from "../GatedState";
import { AdminCard, Banner, ConfirmButton, CopyButton, ErrorState, Field, KeyVal, RefreshButton, Spinner, StatusBadge, TextField, type Tone } from "../ui";
import { CaretDown, Info, Lock, Plus, Stack, Warning } from "../icons";
import { whenUtc } from "./PlayersTab";

const ROUTE = "/api/admin/sets";
const STATUS_TONE: Record<AdminSet["status"], Tone> = { draft: "accent", revealed: "warning", released: "ok" };
const short = (h: string | null | undefined) => (h ? `${h.slice(0, 10)}…${h.slice(-6)}` : "–");

/** ISO → the value a datetime-local input shows (the operator's own clock), and back. */
function toInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
const fromInput = (v: string): string | null => (v ? new Date(v).toISOString() : null);

function duration(sec: number | null): string {
  if (sec === null) return "–";
  if (sec < 60) return `${sec} s`;
  if (sec < 3600) return `${Math.round(sec / 60)} min`;
  return `${(sec / 3600).toFixed(1)} h`;
}

const BTN =
  "inline-flex items-center gap-1.5 rounded-xl border-[3px] border-ink bg-paper px-3 py-1.5 text-xs font-extrabold shadow-[2px_2px_0_#1b1714] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40";

type Send = <R>(to: string, body: unknown) => Promise<R | AdminSendError>;

const SELECT = "w-full rounded-xl border-[3px] border-ink bg-paper px-2 py-1.5 text-sm font-bold outline-none disabled:opacity-50";

/** A picked file as base64 (no `data:` prefix), or a reason it can't be a stamp. The server checks again, by the bytes. */
function readStampFile(file: File): Promise<{ ok: true; data: string } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    if (!(STAMP_TYPES as readonly string[]).includes(file.type)) return resolve({ ok: false, error: "A stamp is a PNG or a JPEG (never an SVG)." });
    if (file.size > STAMP_MAX_BYTES) return resolve({ ok: false, error: `A stamp is at most ${Math.round(STAMP_MAX_BYTES / 1024)} KB.` });
    const reader = new FileReader();
    reader.onerror = () => resolve({ ok: false, error: "Couldn’t read that file." });
    reader.onload = () => resolve({ ok: true, data: String(reader.result).replace(/^data:[^,]*,/, "") });
    reader.readAsDataURL(file);
  });
}

/** The two colors side by side with the stamp on them: a stand-in until the card itself is drawn here. */
function LookSwatch({ a, b, stamp }: { a: string; b: string; stamp: string | null }) {
  const ok = (c: string) => /^#[0-9a-f]{6}$/i.test(c);
  return (
    <div
      className="relative flex h-16 w-28 items-center justify-center overflow-hidden rounded-xl border-[3px] border-ink"
      style={{ background: ok(a) && ok(b) ? `linear-gradient(135deg, ${a} 0 50%, ${b} 50% 100%)` : undefined }}
      aria-label="The set’s two colors and its stamp"
    >
      {/* A data: address from this operator's own upload. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {stamp ? <img src={stamp} alt="" className="h-10 w-10 object-contain" /> : <span className="rounded-md bg-paper/90 px-1.5 py-0.5 text-[10px] font-bold text-ink/70">no stamp</span>}
    </div>
  );
}

/** A root change, ready to send: the calls in order, as cast commands and as one Safe batch. */
function PlanOutput({ intents, name }: { intents: TxIntent[]; name: string }) {
  const [showSafe, setShowSafe] = useState(false);
  if (intents.length === 0) return null;
  // `&&`: a call runs only if the one before it succeeded, so the root never lands without its gate.
  const cast = intents.map((i) => castCommand(i)).join(" && \\\n");
  const safe = safeBatchJson(intents, { name }, NETWORK.id);
  return (
    <div className="mt-3 space-y-2">
      <ol className="list-decimal space-y-1 pl-5 text-xs text-ink/75">
        {intents.map((i) => (
          <li key={i.signature}>
            <span className="font-mono">{i.fn}</span>: {i.note}
          </li>
        ))}
      </ol>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-wider text-ink/45">cast send{intents.length > 1 ? " (in this order)" : ""}</span>
          <CopyButton text={cast} small />
        </div>
        <pre className="max-h-52 overflow-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-2.5 font-mono text-[11px] leading-relaxed text-ink/85">{cast}</pre>
      </div>
      <div>
        <button onClick={() => setShowSafe((s) => !s)} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-ink/45">
          <CaretDown weight="bold" size={12} className={showSafe ? "rotate-180" : ""} /> Safe transaction builder JSON{intents.length > 1 ? " (both calls in ONE transaction)" : ""}
        </button>
        {showSafe && (
          <div className="mt-1">
            <div className="mb-1 flex justify-end">
              <CopyButton text={safe} small label="Copy JSON" />
            </div>
            <pre className="max-h-60 overflow-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-2.5 font-mono text-[10px] leading-relaxed text-ink/75">{safe}</pre>
          </div>
        )}
      </div>
      <p className="text-[11px] text-ink/55">
        After it confirms, press <strong>Check the chain</strong>: a release is marked from the chain’s own root, never by hand.
      </p>
    </div>
  );
}

function WordList({ label, words, tone = "ok" }: { label: string; words: string[]; tone?: Tone }) {
  if (words.length === 0) return null;
  return (
    <details className="text-xs">
      <summary className={`cursor-pointer font-bold ${tone === "warning" ? "text-gold-deep" : "text-ink/70"}`}>
        {label} ({words.length})
      </summary>
      <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-ink/75">{words.join(" ")}</p>
    </details>
  );
}

function ReserveCard({ data, send, reload }: { data: AdminSetsPayload; send: Send; reload: () => void }) {
  const [plan, setPlan] = useState<ReservePlan | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const pending = data.pending;
  const outOfDate = Boolean(pending && (pending.removed > 0 || pending.added > 0));
  const build = async () => {
    setBusy(true);
    setErr(null);
    const res = await send<ReservePlan>(ROUTE, { action: "planReserve" });
    setBusy(false);
    if (!res.ok) return void setErr(res.error);
    setPlan(res);
  };
  const confirm = async () => {
    setBusy(true);
    await send(ROUTE, { action: "confirm" });
    setBusy(false);
    setPlan(null);
    reload();
  };
  return (
    <AdminCard title="The chain’s root">
      <div className="grid gap-x-6 sm:grid-cols-2">
        <KeyVal k="Words.dictionaryRoot" v={data.chain.deployed ? short(data.chain.root) : "no deployment here"} mono />
        <KeyVal k="The full dictionary’s root" v={short(data.chain.fullRoot)} mono />
        <KeyVal k="Held back on the chain" v={data.chain.known ? `${data.chain.held} words` : "unknown root"} />
        <KeyVal k="First-day gate" v={data.chain.gate ? "this Words has it" : "not on this Words (next redeploy)"} />
      </div>
      {!data.chain.known && (
        <div className="mt-3">
          <Banner tone="error" icon={<Warning weight="bold" size={14} />}>
            The chain holds a root this server can’t rebuild: one never built here, or one built before the word list last grew. Claims answer
            “dictionary_mismatch” until the reserve root below is sent (it is built from the sets and the dictionary alone).
          </Banner>
        </div>
      )}
      {data.chain.known && (
        <div className="mt-3">
          <Banner tone={outOfDate ? "warning" : "ok"} icon={outOfDate ? <Warning weight="bold" size={14} /> : <Info weight="bold" size={14} />}>
            {outOfDate ? (
              <>
                <strong>Root out of date.</strong> The sets hold back {pending!.removed} word{pending!.removed === 1 ? "" : "s"} the chain still lets
                through{pending!.added > 0 ? `, and the chain holds back ${pending!.added} that no unreleased set has any more` : ""}. The game already
                refuses them, but only the root makes it final.
              </>
            ) : (
              <>The chain holds back exactly what the sets say.</>
            )}
          </Banner>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button className={BTN} onClick={build} disabled={busy || !data.migrated}>
          <Lock weight="bold" size={13} /> Build the reserve root
        </button>
        <button className={BTN} onClick={confirm} disabled={busy}>
          Check the chain
        </button>
        {err && <span className="text-xs font-bold text-candy">{err}</span>}
      </div>
      {plan && (
        <div className="mt-3 space-y-2 rounded-xl border-2 border-ink/15 p-3">
          {plan.upToDate ? (
            <p className="text-sm text-ink/70">Nothing to send: the chain already holds this root.</p>
          ) : (
            <>
              <p className="text-sm">
                New root <span className="font-mono">{short(plan.root)}</span>: holds back {plan.holds} words in all
                {plan.chainKnown ? ` (${plan.removed.length} more than now, ${plan.added.length} let go)` : ""}.
              </p>
              {!plan.chainKnown && (
                <p className="text-xs text-ink/60">The chain’s current root isn’t one built here, so what this changes can’t be listed.</p>
              )}
              {plan.dictionaryChanged && (
                <p className="text-xs text-ink/60">The word list has grown since the chain’s root was built: this root also takes in the new words.</p>
              )}
              <WordList label="Newly held back" words={plan.removed} />
              <WordList label="Let go (claimable again)" words={plan.added} tone="warning" />
              {plan.alreadyClaimed === null ? (
                <p className="text-xs text-ink/55">Couldn’t read which of these words are already owned.</p>
              ) : (
                <WordList label="Already owned by a player: they stay owned; the root only stops a re-claim" words={plan.alreadyClaimed} tone="warning" />
              )}
              <PlanOutput intents={plan.intents} name="Words: reserve" />
            </>
          )}
        </div>
      )}
    </AdminCard>
  );
}

function ImportExport({ data, send, reload }: { data: AdminSetsPayload; send: Send; reload: () => void }) {
  const [text, setText] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const file = useMemo(() => JSON.stringify(data.file, null, 2), [data.file]);
  const drafts = data.sets.filter((s) => s.status === "draft").length;
  const run = async () => {
    setErrors([]);
    setDone(null);
    const res = await send<{ ok: true; sets: number; words: number }>(ROUTE, { action: "import", text });
    if (!res.ok) return void setErrors(res.errors ?? [res.error]);
    setDone(`Imported ${res.sets} sets, ${res.words} words.`);
    setText("");
    reload();
  };
  return (
    <AdminCard title="Import and export" action={<CopyButton text={file} small label="Copy the export" />}>
      <p className="mb-2 text-xs text-ink/60">
        The export is every unreleased set. An import <strong>replaces every draft</strong> ({drafts} now) with the file’s sets, all or nothing;
        revealed and released sets are never touched. Shape:{" "}
        <code>{'{ "sets": [ { "name", "words": ["CRANE", …], "headliners": [], "revealAt", "releaseAt", "gateHours", "perPlayerLimit" } ] }'}</code>
      </p>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        spellCheck={false}
        placeholder="Paste the JSON here"
        className="w-full rounded-xl border-[3px] border-ink bg-paper px-3 py-2 font-mono text-xs outline-none"
      />
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <ConfirmButton phrase="replace" onConfirm={run} disabled={!text.trim() || !data.migrated}>
          Import (replaces the drafts)
        </ConfirmButton>
        {done && <span className="text-xs font-bold text-teal-ink">{done}</span>}
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-candy">
          {errors.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      )}
    </AdminCard>
  );
}

function SetCard({
  set,
  all,
  gate,
  collabReady,
  send,
  reload,
  index,
}: {
  set: AdminSet;
  all: AdminSet[];
  gate: boolean;
  /** Migration 0023 has run: a set's type, look, and first-day rule can be saved. */
  collabReady: boolean;
  send: Send;
  reload: () => void;
  index: number;
}) {
  const draft = set.status === "draft";
  const scheduled = set.status !== "released";
  const [name, setName] = useState(set.name);
  const [revealAt, setRevealAt] = useState(toInput(set.revealAt));
  const [releaseAt, setReleaseAt] = useState(toInput(set.releaseAt));
  const [gateHours, setGateHours] = useState(String(set.gateHours));
  const [limit, setLimit] = useState(String(set.perPlayerLimit));
  const [type, setType] = useState(set.type);
  const [partnerName, setPartnerName] = useState(set.partnerName ?? "");
  const [partnerUrl, setPartnerUrl] = useState(set.partnerUrl ?? "");
  const [colorA, setColorA] = useState(set.colorA ?? "");
  const [colorB, setColorB] = useState(set.colorB ?? "");
  const [gateRule, setGateRule] = useState(set.gateRule);
  const [gateToken, setGateToken] = useState(set.gateToken ?? "");
  const [gateMin, setGateMin] = useState(set.gateMin ?? "");
  const [gateLabel, setGateLabel] = useState(set.gateLabel ?? "");
  const [list, setList] = useState("");
  const [add, setAdd] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [moveTo, setMoveTo] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [plan, setPlan] = useState<ReleasePlan | null>(null);
  const others = all.filter((s) => s.status === "draft" && s.id !== set.id);

  const act = async (body: Record<string, unknown>, ok?: (r: Record<string, unknown>) => string | null) => {
    setNote(null);
    const res = await send<Record<string, unknown> & { ok: true }>(ROUTE, body);
    if (!res.ok) return void setNote(res.errors?.join(" · ") ?? res.detail ?? res.error);
    setNote(ok ? ok(res) : null);
    setPicked([]);
    reload();
  };
  const save = () =>
    act({
      action: "update",
      id: set.id,
      ...(draft ? { name } : {}),
      revealAt: draft ? fromInput(revealAt) : undefined,
      releaseAt: fromInput(releaseAt),
      gateHours,
      perPlayerLimit: limit,
      // The look is a draft's to edit; the first day's rule can change until the release. Sent only
      // when it differs from what is saved, so a plain set saves as before (and before migration 0023).
      ...(draft && type !== set.type ? { type } : {}),
      ...(draft && partnerName !== (set.partnerName ?? "") ? { partnerName } : {}),
      ...(draft && partnerUrl !== (set.partnerUrl ?? "") ? { partnerUrl } : {}),
      ...(draft && colorA !== (set.colorA ?? "") ? { colorA } : {}),
      ...(draft && colorB !== (set.colorB ?? "") ? { colorB } : {}),
      ...(gateRule !== set.gateRule ? { gateRule } : {}),
      ...(gateToken !== (set.gateToken ?? "") ? { gateToken } : {}),
      ...(gateMin !== (set.gateMin ?? "") ? { gateMin } : {}),
      ...(gateLabel !== (set.gateLabel ?? "") ? { gateLabel } : {}),
    });
  const uploadStamp = async (file: File | undefined) => {
    if (!file) return;
    const read = await readStampFile(file);
    if (!read.ok) return void setNote(read.error);
    await act({ action: "stamp", id: set.id, data: read.data }, () => "stamp saved");
  };
  const importList = () =>
    act({ action: "allowlist", id: set.id, text: list }, (r) => {
      setList("");
      return `${r.wallets} wallets on the list${Number(r.bad) > 0 ? ` · ${r.bad} entries weren’t wallets and were left out` : ""}`;
    });
  const addWords = () =>
    act({ action: "addWords", id: set.id, words: add }, (r) => {
      setAdd("");
      const parts = [`added ${(r.added as string[]).length}`];
      for (const [k, label] of [["taken", "in another set"], ["unknown", "not in the dictionary"], ["malformed", "not five letters"]] as const) {
        const list = r[k] as string[];
        if (list.length) parts.push(`${label}: ${list.join(" ")}`);
      }
      return parts.join(" · ");
    });
  const buildRelease = async () => {
    setNote(null);
    const res = await send<ReleasePlan>(ROUTE, { action: "planRelease", id: set.id });
    if (!res.ok) return void setNote(res.detail ?? res.error);
    setPlan(res);
  };
  const toggle = (w: string) => setPicked((p) => (p.includes(w) ? p.filter((x) => x !== w) : [...p, w]));
  const heads = new Set(set.words.filter((w) => w.headliner).map((w) => w.word));

  return (
    <AdminCard
      title={
        <span className="flex flex-wrap items-center gap-2">
          {set.name || "Untitled"} <StatusBadge tone={STATUS_TONE[set.status]}>{set.status}</StatusBadge>
          {set.type === "collab" && <StatusBadge tone="accent">collab</StatusBadge>}
          <span className="text-xs font-normal text-ink/50">{set.words.length} words</span>
        </span>
      }
      action={
        <span className="flex items-center gap-1">
          <button className={BTN} title="Earlier in the list" disabled={index === 0} onClick={() => act({ action: "reorder", ids: swap(all, index, index - 1) })}>
            ↑
          </button>
          <button className={BTN} title="Later in the list" disabled={index === all.length - 1} onClick={() => act({ action: "reorder", ids: swap(all, index, index + 1) })}>
            ↓
          </button>
        </span>
      }
    >
      {set.claimed && set.claimed.length > 0 && (
        <div className="mb-3">
          <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
            Already owned by a player, so holding {set.claimed.length === 1 ? "it" : "them"} back changes nothing until a dissolve:{" "}
            <span className="font-mono">{set.claimed.join(" ")}</span>
          </Banner>
        </div>
      )}
      {set.open.length > 0 && (
        <div className="mb-3">
          <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
            {set.open.length} of these words {set.open.length === 1 ? "is" : "are"} not held back on the chain yet (the game refuses them; the root
            doesn’t). Build the reserve root above.
          </Banner>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Name" hint={draft ? undefined : "locked"}>
          <TextField value={name} onChange={(e) => setName(e.target.value)} disabled={!draft} />
        </Field>
        <Field label="Reveal at" hint={draft ? "your clock; empty = by hand" : whenUtc(set.revealedAt)}>
          <TextField type="datetime-local" value={revealAt} onChange={(e) => setRevealAt(e.target.value)} disabled={!draft} />
        </Field>
        <Field label="Release at" hint={scheduled ? "the plan; you send it" : whenUtc(set.releasedAt)}>
          <TextField type="datetime-local" value={releaseAt} onChange={(e) => setReleaseAt(e.target.value)} disabled={!scheduled} />
        </Field>
        <Field label="Gate, hours" hint="0 = none, 168 at most">
          <TextField inputMode="numeric" value={gateHours} onChange={(e) => setGateHours(e.target.value)} disabled={!scheduled} />
        </Field>
        <Field label="Words a player, gated" hint="per profile">
          <TextField inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} disabled={!scheduled} />
        </Field>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Field label="Type" hint={draft ? `collab: exactly ${COLLAB_WORDS} words` : "locked"}>
          <select value={type} onChange={(e) => setType(e.target.value as AdminSet["type"])} disabled={!draft || !collabReady} className={SELECT}>
            <option value="standard">Standard</option>
            <option value="collab">Collab (with a partner)</option>
          </select>
        </Field>
        {type === "collab" && (
          <>
            <Field label="Partner" hint={draft ? "private until the reveal" : "locked"}>
              <TextField value={partnerName} onChange={(e) => setPartnerName(e.target.value)} disabled={!draft} />
            </Field>
            <Field label="Partner’s link" hint="https://… (optional)">
              <TextField value={partnerUrl} onChange={(e) => setPartnerUrl(e.target.value)} disabled={!draft} placeholder="https://" />
            </Field>
            {(
              [
                ["Color 1", colorA, setColorA],
                ["Color 2", colorB, setColorB],
              ] as const
            ).map(([label, value, setValue]) => (
              <Field key={label} label={label} hint="#rrggbb">
                <span className="flex items-center gap-2">
                  <input
                    type="color"
                    aria-label={`${label}, picker`}
                    value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#888888"}
                    onChange={(e) => setValue(e.target.value)}
                    disabled={!draft}
                    className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border-[3px] border-ink bg-paper p-0.5 disabled:opacity-50"
                  />
                  <TextField value={value} onChange={(e) => setValue(e.target.value)} disabled={!draft} placeholder="#1f6f8b" />
                </span>
              </Field>
            ))}
          </>
        )}
      </div>

      {type === "collab" && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <LookSwatch a={colorA} b={colorB} stamp={set.stamp} />
          {draft && set.type === "collab" && (
            <span className="flex flex-wrap items-center gap-2">
              <label className={`${BTN} cursor-pointer`}>
                {set.stamp ? "Replace the stamp" : "Upload the stamp"}
                <input type="file" accept={STAMP_TYPES.join(",")} className="sr-only" onChange={(e) => (uploadStamp(e.target.files?.[0]), (e.target.value = ""))} />
              </label>
              {set.stamp && (
                <button className={BTN} onClick={() => act({ action: "clearStamp", id: set.id })}>
                  Remove it
                </button>
              )}
              <span className="text-[11px] text-ink/55">PNG or JPEG, at most {Math.round(STAMP_MAX_BYTES / 1024)} KB. Never an SVG.</span>
            </span>
          )}
          {draft && set.type !== "collab" && <span className="text-xs text-ink/60">Save the set as a collab first, then upload its stamp.</span>}
        </div>
      )}

      {scheduled && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="First day open to" hint="always verified players only">
            <select value={gateRule} onChange={(e) => setGateRule(e.target.value as AdminSet["gateRule"])} disabled={!collabReady} className={SELECT}>
              <option value="verified">Every verified player</option>
              <option value="allowlist">Wallets on a list</option>
              <option value="token">Holders of a token on Base</option>
            </select>
          </Field>
          {gateRule === "token" && (
            <>
              <Field label="Token contract" hint="on Base mainnet">
                <TextField value={gateToken} onChange={(e) => setGateToken(e.target.value)} placeholder="0x…" />
              </Field>
              <Field label="Minimum balance" hint="smallest unit: 1 for one collectible">
                <TextField inputMode="numeric" value={gateMin} onChange={(e) => setGateMin(e.target.value)} placeholder="1000000000000000000" />
              </Field>
            </>
          )}
          {gateRule !== "verified" && (
            <Field label="Who that is, for players" hint="ends “open to …”">
              <TextField value={gateLabel} onChange={(e) => setGateLabel(e.target.value)} placeholder={gateRule === "token" ? "holders of …" : "players on this set’s list"} />
            </Field>
          )}
        </div>
      )}
      {scheduled && gateRule === "allowlist" && set.gateRule === "allowlist" && (
        <div className="mt-3">
          <Field label={`The list (${set.allowlistCount.toLocaleString("en-US")} wallets now)`} hint="a paste replaces the whole list; wallets are never shown back">
            <textarea
              value={list}
              onChange={(e) => setList(e.target.value)}
              rows={3}
              spellCheck={false}
              placeholder="0x… one per line, or separated by commas"
              className="w-full rounded-xl border-[3px] border-ink bg-paper px-3 py-2 font-mono text-xs outline-none"
            />
          </Field>
          <div className="mt-2">
            <ConfirmButton phrase="replace" onConfirm={importList} disabled={!list.trim()}>
              Import the list (replaces it)
            </ConfirmButton>
          </div>
        </div>
      )}
      {scheduled && gateRule === "allowlist" && set.gateRule !== "allowlist" && <p className="mt-2 text-xs text-ink/60">Save the rule first, then paste the list.</p>}

      {set.needs.length > 0 && (
        <div className="mt-3">
          <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
            {draft ? "Before it can be revealed" : "Before its release can be built"}: {set.needs.join("; ")}.
          </Banner>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {set.words.map((w) => (
          <button
            key={w.word}
            onClick={() => draft && toggle(w.word)}
            className={`rounded-lg border-2 px-2 py-0.5 font-mono text-xs ${picked.includes(w.word) ? "border-ink bg-ink text-paper" : "border-ink/25 bg-paper"} ${draft ? "" : "cursor-default"}`}
            title={heads.has(w.word) ? "headliner" : undefined}
          >
            {heads.has(w.word) ? "★ " : ""}
            {w.word}
          </button>
        ))}
        {set.words.length === 0 && <span className="text-xs text-ink/50">No words yet.</span>}
      </div>

      {draft && (
        <div className="mt-3 space-y-2">
          {picked.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="font-bold">{picked.length} picked:</span>
              <button className={BTN} onClick={() => act({ action: "removeWords", id: set.id, words: picked })}>
                Remove
              </button>
              {picked.length === 1 && (
                <button className={BTN} onClick={() => act({ action: "headliner", id: set.id, word: picked[0], on: !heads.has(picked[0]) })}>
                  {heads.has(picked[0]) ? "Not a headliner" : "Make it a headliner"}
                </button>
              )}
              {others.length > 0 && (
                <>
                  <select value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="rounded-xl border-[3px] border-ink bg-paper px-2 py-1 text-xs font-bold">
                    <option value="">Move to…</option>
                    {others.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  <button className={BTN} disabled={!moveTo} onClick={() => act({ action: "moveWords", words: picked, to: Number(moveTo) })}>
                    Move
                  </button>
                </>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[220px] flex-1">
              <Field label="Add words" hint="spaces, commas, or lines">
                <TextField value={add} onChange={(e) => setAdd(e.target.value)} placeholder="CRANE PLUMB …" />
              </Field>
            </div>
            <button className={BTN} disabled={!add.trim()} onClick={addWords}>
              <Plus weight="bold" size={13} /> Add
            </button>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {scheduled && (
          <button className={BTN} onClick={save}>
            Save
          </button>
        )}
        {draft && (
          <>
            <ConfirmButton phrase="reveal" onConfirm={() => act({ action: "reveal", id: set.id })} disabled={set.words.length === 0 || set.needs.length > 0}>
              Reveal now (locks the words)
            </ConfirmButton>
            <ConfirmButton phrase="delete" onConfirm={() => act({ action: "delete", id: set.id })}>
              Delete
            </ConfirmButton>
          </>
        )}
        {set.status === "revealed" && (
          <button className={BTN} onClick={buildRelease}>
            Build the release
          </button>
        )}
        {note && <span className="text-xs font-bold text-ink/70">{note}</span>}
      </div>

      {plan && (
        <div className="mt-3 space-y-2 rounded-xl border-2 border-ink/15 p-3">
          <p className="text-sm">
            New root <span className="font-mono">{short(plan.root)}</span>: adds {plan.added.length} words, removes none.
          </p>
          <WordList label="Added" words={plan.added} />
          <p className="text-xs text-ink/65">
            {plan.gate
              ? `The gate is set first, until ${whenUtc(new Date(plan.gate.until * 1000).toISOString())}; one word a player needs a voucher until then.`
              : plan.gateNote}
          </p>
          {!gate && set.gateHours > 0 && (
            <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
              No first-day limit can be enforced on this network until Words is redeployed with the gate.
            </Banner>
          )}
          <PlanOutput intents={plan.intents} name={`Words: release ${set.name}`} />
        </div>
      )}

      {set.status === "released" && (
        <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
          <KeyVal k="Released" v={whenUtc(set.releasedAt)} />
          <KeyVal k="Gate lifts" v={set.gateUntil ? whenUtc(set.gateUntil) : "no gate"} />
          <KeyVal
            k="First day open to"
            v={
              set.gateRule === "verified"
                ? "every verified player"
                : `${set.gateLabel ?? (set.gateRule === "token" ? "holders of a token" : "wallets on a list")} (${set.gateRule === "token" ? `at least ${set.gateMin ?? "?"} of ${short(set.gateToken)}` : `${set.allowlistCount.toLocaleString("en-US")} wallets`})`
            }
          />
          {set.stats ? (
            <>
              <KeyVal k="Claimed" v={`${set.stats.claimedNow ?? "–"} of ${set.stats.total}`} />
              <KeyVal k="Time to the first claim" v={duration(set.stats.firstClaimSeconds)} />
              <KeyVal k="Players who claimed" v={`${set.stats.uniqueClaimers} wallets`} />
              <KeyVal k="Claims during the gate / after" v={`${set.stats.duringGate} / ${set.stats.afterGate}`} />
            </>
          ) : (
            <KeyVal k="Claims" v="couldn’t be read just now" />
          )}
        </div>
      )}
    </AdminCard>
  );
}

/** The ids in list order with two neighbours swapped: what `reorder` takes. */
function swap(all: AdminSet[], a: number, b: number): number[] {
  const ids = all.map((s) => s.id);
  [ids[a], ids[b]] = [ids[b], ids[a]];
  return ids;
}

export function SetsTab() {
  const api = useAdminApi<AdminSetsPayload>(ROUTE);
  const [newName, setNewName] = useState("");
  const data = api.data;
  const reload = () => api.reload();
  const [testNote, setTestNote] = useState<string | null>(null);
  const create = async () => {
    const res = await api.send(ROUTE, { action: "create", name: newName, sort: data?.sets.length ?? 0 });
    if ((res as { ok: boolean }).ok) {
      setNewName("");
      reload();
    }
  };
  const makeTestCollab = async () => {
    setTestNote(null);
    const res = await api.send<{ ok: true; id: number }>(ROUTE, { action: "testCollab" });
    if (!res.ok) {
      const why: Record<string, string> = {
        exists: "There is already a set named “Test collab”.",
        not_testnet: "Only on a test network.",
        not_migrated: "Run migration 0023 first.",
        no_words: "Couldn’t find five free words just now. Try again.",
        try_again: "The chain or the database couldn’t be read. Try again.",
      };
      return void setTestNote(why[res.error] ?? res.error);
    }
    setTestNote("Made as a draft, below. Reveal it, send the reserve root, then build its release.");
    reload();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Stack weight="bold" size={18} />
          <h2 className="font-display text-lg font-extrabold">Sets</h2>
          {data && <span className="text-xs text-ink/50">{data.sets.length} sets · {data.network}</span>}
        </div>
        <RefreshButton onClick={reload} loading={api.loading} />
      </div>

      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        Themed groups of dictionary words, held back and released later. A draft is fully editable; a revealed set’s name and words are locked; a
        released set is permanent. <strong>The lists are private and the repository is public</strong>: they live only in this database. What can’t
        be hidden is <em>which</em> words are held back, because the game answers “not available yet” for any word asked.
      </Banner>

      {api.refusal ? (
        <GatedState refusal={api.refusal} canSignIn={api.canSignIn} signIn={api.signIn} signingIn={api.signingIn} signInError={api.signInError} address={api.address} />
      ) : api.loading && !data ? (
        <Spinner />
      ) : api.error || !data ? (
        <ErrorState msg={api.error ?? "Failed to load"} onRetry={reload} />
      ) : (
        <>
          {!data.migrated && (
            <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
              The set tables aren’t in this database yet: run migration <code>0021_reserved_sets</code> (<code>npm run db:migrate</code>). Until
              then there are no sets and the game is as it was.
            </Banner>
          )}

          {data.migrated && !data.collab && (
            <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
              Collab sets and first-day rules need migration <code>0023_collab_sets</code> (<code>npm run db:migrate</code>). Until it runs, every
              set is a standard one and everything else here works as before.
            </Banner>
          )}

          <ReserveCard data={data} send={api.send} reload={reload} />

          <AdminCard title="The commitment" action={<CopyButton text={data.commitment} small />}>
            <p className="break-all font-mono text-xs">{data.commitment}</p>
            <p className="mt-2 text-xs text-ink/60">
              keccak256 of the canonical JSON of every unreleased set (each set’s name, words, and headliners; sets by name, words A to Z). Publish
              it to prove later that the lists didn’t change. It changes with any edit to a name, a word, or a headliner, and with every release;
              dates, the gate, and the order don’t move it. <code>npm run sets -- commitment</code> prints the same hash.
            </p>
          </AdminCard>

          <ImportExport data={data} send={api.send} reload={reload} />

          <AdminCard title="A new set">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[220px] flex-1">
                <Field label="Name" hint="private until the set is revealed">
                  <TextField value={newName} onChange={(e) => setNewName(e.target.value)} />
                </Field>
              </div>
              <button className={BTN} onClick={create} disabled={!newName.trim() || !data.migrated}>
                <Plus weight="bold" size={13} /> Create a draft
              </button>
            </div>
          </AdminCard>

          {data.testnet && (
            <AdminCard title="A test collab">
              <p className="mb-2 text-xs text-ink/60">
                A placeholder collab set for this test network, so the card can be seen: “Test collab”, two arbitrary colors, a plain stamp, and
                five free words picked now. It names no real partner, it is made as a draft, and it can’t be made on mainnet. A collab set
                can be revealed once the collab card ships; until then the draft is here to look at and edit.
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <button className={BTN} onClick={makeTestCollab} disabled={!data.collab || data.sets.some((s) => s.name === "Test collab")}>
                  <Plus weight="bold" size={13} /> Make the Test collab draft
                </button>
                {testNote && <span className="text-xs font-bold text-ink/70">{testNote}</span>}
              </div>
            </AdminCard>
          )}

          {data.sets.map((s, i) => (
            // Keyed by what the server last said, so a reload refills the form from the saved set.
            <SetCard
              key={[s.id, s.status, s.words.length, s.name, s.releaseAt, s.revealAt, s.type, s.partnerName, s.partnerUrl, s.colorA, s.colorB, s.gateRule, s.gateToken, s.gateMin, s.gateLabel].join(":")}
              set={s}
              all={data.sets}
              gate={data.chain.gate}
              collabReady={data.collab}
              send={api.send}
              reload={reload}
              index={i}
            />
          ))}
        </>
      )}
    </div>
  );
}
