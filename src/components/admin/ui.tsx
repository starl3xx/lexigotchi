"use client";
/**
 * Admin dashboard UI kit — Griddle's operator-console vocabulary (tone system, metric cards with
 * sparkline + delta pill, target-band scorecards, type-to-confirm danger actions, copy buttons)
 * rendered in Lexigotchi's cel / aged-paper design language so the admin feels of-a-piece with the
 * game. Shared by every tab.
 */
import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Check, CircleNotch, ArrowsClockwise, Copy, Warning } from "./icons";

export type Tone = "ok" | "warning" | "error" | "accent";

const TONE_HEX: Record<Tone, string> = {
  ok: "#1b1714",
  warning: "#e0a93b",
  error: "#d8463f",
  accent: "#2a9d8f",
};
const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ink",
  warning: "text-gold-deep",
  error: "text-candy",
  accent: "text-teal",
};
const TONE_ICON: Record<Tone, string> = {
  ok: "text-ink/45",
  warning: "text-gold-deep",
  error: "text-candy",
  accent: "text-teal",
};

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function AdminCard({
  children,
  className = "",
  title,
  action,
}: {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className={`cel rounded-2xl bg-paper p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="font-display text-sm font-extrabold">{title}</h3>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink/45">{children}</div>
  );
}

export function Banner({
  tone = "ok",
  icon,
  children,
}: {
  tone?: Tone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  const bg: Record<Tone, string> = {
    ok: "bg-ink/[0.04] border-ink/15",
    warning: "bg-gold/15 border-gold-deep/40",
    error: "bg-candy/10 border-candy/40",
    accent: "bg-teal/10 border-teal/40",
  };
  return (
    <div className={`flex items-start gap-2 rounded-xl border-2 ${bg[tone]} px-3 py-2 text-sm text-ink/80`}>
      {icon && <span className={`mt-0.5 shrink-0 ${TONE_ICON[tone]}`}>{icon}</span>}
      <div>{children}</div>
    </div>
  );
}

export function KeyVal({ k, v, mono }: { k: ReactNode; v: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b-2 border-ink/10 py-1.5 text-sm last:border-0">
      <span className="text-ink/60">{k}</span>
      <span className={`font-bold ${mono ? "font-mono text-xs" : ""}`}>{v}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric card (sparkline + delta pill) — Griddle's SparklineCard, cel-styled
// ---------------------------------------------------------------------------

function deltaPill(delta: number | null | undefined, kind: "abs" | "pct") {
  if (delta == null || !Number.isFinite(delta)) return null;
  const arrow = delta > 0 ? "▲" : delta < 0 ? "▼" : "–";
  const color = delta > 0 ? "text-teal" : delta < 0 ? "text-candy" : "text-ink/40";
  const str =
    kind === "pct"
      ? `${Math.abs(delta * 100).toFixed(1)}%`
      : Math.abs(Math.round(delta)).toLocaleString();
  return { arrow, color, str };
}

export function MetricCard({
  icon,
  label,
  value,
  sub,
  tone = "ok",
  series,
  delta,
  deltaKind = "abs",
}: {
  icon?: ReactNode;
  label: string;
  value: ReactNode;
  sub?: string;
  tone?: Tone;
  series?: number[];
  delta?: number | null;
  deltaKind?: "abs" | "pct";
}) {
  const rawId = useId();
  const gid = `spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const pill = deltaPill(delta, deltaKind);
  const data = series?.map((value) => ({ value })) ?? [];
  return (
    <div className="cel flex flex-col gap-1 rounded-2xl bg-paper p-3.5">
      <div className={`flex items-center gap-1.5 ${TONE_ICON[tone]}`}>
        {icon}
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink/50">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <div className={`font-display text-2xl font-extrabold tabular-nums ${TONE_TEXT[tone]}`}>
          {value}
        </div>
        {pill && <span className={`text-[11px] font-bold ${pill.color}`}>{pill.arrow} {pill.str}</span>}
      </div>
      {sub && <div className="text-[11px] font-medium text-ink/50">{sub}</div>}
      {data.length > 1 && (
        <div className="-mx-1 mt-1 h-8">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={TONE_HEX[tone]} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={TONE_HEX[tone]} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="value" stroke={TONE_HEX[tone]} strokeWidth={1.5} fill={`url(#${gid})`} isAnimationActive={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scorecard (target-band health tile) — LHAW economics parity
// ---------------------------------------------------------------------------

const STATUS_DOT: Record<"ok" | "warning" | "error", string> = {
  ok: "bg-teal",
  warning: "bg-gold",
  error: "bg-candy",
};

export function Scorecard({
  label,
  value,
  status,
  detail,
}: {
  label: string;
  value: ReactNode;
  status: "ok" | "warning" | "error";
  detail: string;
}) {
  return (
    <div className="cel rounded-2xl bg-paper p-3.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-ink/50">{label}</span>
        <span className={`h-2.5 w-2.5 rounded-full ${STATUS_DOT[status]}`} />
      </div>
      <div className="mt-1 font-display text-xl font-extrabold">{value}</div>
      <div className="mt-1 text-[11px] leading-snug text-ink/55">{detail}</div>
    </div>
  );
}

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  const cls: Record<Tone, string> = {
    ok: "bg-teal/20 text-teal",
    warning: "bg-gold/25 text-gold-deep",
    error: "bg-candy/20 text-candy",
    accent: "bg-ink/10 text-ink",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-[11px] font-bold ${cls[tone]}`}>
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Form controls
// ---------------------------------------------------------------------------

export function Field({ label, hint, children }: { label: ReactNode; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-bold text-ink/70">{label}</span>
        {hint && <span className="text-[10px] text-ink/45">{hint}</span>}
      </div>
      {children}
    </label>
  );
}

export function TextField({
  className = "",
  invalid,
  ...rest
}: { invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`w-full rounded-xl border-[3px] ${invalid ? "border-candy" : "border-ink"} bg-paper px-3 py-2 font-mono text-sm outline-none focus:bg-paper-dark/40 ${className}`}
      {...rest}
    />
  );
}

export function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-xl border-[3px] border-ink bg-paper px-3 py-2 text-sm font-bold outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="inline-flex items-center gap-2"
      aria-pressed={checked}
    >
      <span className={`flex h-6 w-10 items-center rounded-full border-2 border-ink px-0.5 transition-colors ${checked ? "bg-teal" : "bg-paper-dark"}`}>
        <span className={`h-4 w-4 rounded-full border-2 border-ink bg-paper transition-transform ${checked ? "translate-x-4" : ""}`} />
      </span>
      {label && <span className="text-sm font-bold">{label}</span>}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

export function CopyButton({ text, label = "Copy", small }: { text: string; label?: string; small?: boolean }) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1400);
    } catch {
      /* clipboard blocked — non-fatal */
    }
  };
  return (
    <button
      onClick={copy}
      className={`inline-flex items-center gap-1.5 rounded-lg border-2 border-ink bg-paper font-bold active:translate-y-[1px] ${small ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"}`}
    >
      {done ? <Check weight="bold" size={13} /> : <Copy weight="bold" size={13} />}
      {done ? "Copied" : label}
    </button>
  );
}

export function RefreshButton({ onClick, loading }: { onClick: () => void; loading?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      aria-label="Refresh"
      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-paper active:translate-y-[1px] disabled:opacity-50"
    >
      <ArrowsClockwise weight="bold" size={14} className={loading ? "animate-spin" : ""} />
    </button>
  );
}

/**
 * Type-to-confirm danger button (LHAW pattern). The operator must type the confirm phrase before
 * the action fires — used for irreversible / sensitive operations.
 */
export function ConfirmButton({
  phrase,
  onConfirm,
  children,
  disabled,
}: {
  phrase: string;
  onConfirm: () => void;
  children: ReactNode;
  disabled?: boolean;
}) {
  const [arming, setArming] = useState(false);
  const [typed, setTyped] = useState("");
  if (!arming) {
    return (
      <button
        onClick={() => setArming(true)}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-xl border-[3px] border-ink bg-paper px-4 py-2 text-sm font-extrabold text-candy shadow-[3px_3px_0_#1b1714] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none disabled:opacity-40"
      >
        {children}
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TextField
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={`type ${phrase}`}
        className="max-w-[180px]"
        autoFocus
      />
      <button
        onClick={() => {
          if (typed.trim() === phrase) {
            onConfirm();
            setArming(false);
            setTyped("");
          }
        }}
        disabled={typed.trim() !== phrase}
        className="rounded-xl border-[3px] border-ink bg-candy px-3 py-2 text-sm font-extrabold text-paper shadow-[3px_3px_0_#1b1714] active:translate-y-[2px] disabled:opacity-40"
      >
        Confirm
      </button>
      <button onClick={() => { setArming(false); setTyped(""); }} className="text-xs font-bold text-ink/50">
        Cancel
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Async data hook + states
// ---------------------------------------------------------------------------

export function Spinner() {
  return (
    <div className="flex justify-center py-12">
      <CircleNotch weight="bold" size={24} className="animate-spin text-ink/40" />
    </div>
  );
}

export function ErrorState({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center">
      <Warning weight="bold" size={24} className="text-candy" />
      <p className="text-sm text-candy">{msg}</p>
      <button onClick={onRetry} className="rounded-lg border-2 border-ink bg-paper px-3 py-1.5 text-xs font-bold">
        Retry
      </button>
    </div>
  );
}

/** Self-fetching data hook used by the metrics tabs (Griddle's per-tab fetch pattern). */
export function useFetch<T>(url: string): { data: T | null; loading: boolean; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tick = useRef(0);
  const load = () => {
    const myTick = ++tick.current;
    setLoading(true);
    setError(null);
    fetch(url, { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error(`Failed to load (${r.status})`);
        return r.json();
      })
      .then((j) => {
        if (myTick === tick.current) setData(j as T);
      })
      .catch((e) => {
        if (myTick === tick.current) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (myTick === tick.current) setLoading(false);
      });
  };
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);
  return { data, loading, error, reload: load };
}
