"use client";
/** Shared rubber-hose UI primitives for the play prototype — cel borders, hard shadows, wood tiles. */
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Tier } from "@/lib/economy";
import { Basket, CircleNotch, Smiley, SmileyMeh, SmileyXEyes, X } from "./ui/icons";
import { useGame, type Hunger, type Toast } from "./state";
import type { Busy } from "@/lib/onchain/actionGate";

// ---------------------------------------------------------------------------
// Button — tactile cel button (the shadow "presses" on tap)
//
// Disabled is neutral (paper, faint ink, no shadow), never the variant's color at low opacity:
// a faded candy button read as an error state ("Post on X" before any letters were picked).
// ---------------------------------------------------------------------------

type Variant = "primary" | "gold" | "teal" | "ghost" | "danger";
const VAR: Record<Variant, string> = {
  primary: "bg-candy-deep text-paper",
  gold: "bg-gold text-ink",
  teal: "bg-teal text-ink",
  ghost: "bg-paper text-ink",
  danger: "bg-paper text-candy-ink",
};

export function Button({
  variant = "primary",
  full,
  size = "md",
  children,
  className = "",
  ...rest
}: {
  variant?: Variant;
  full?: boolean;
  size?: "sm" | "md" | "lg";
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const pad = size === "lg" ? "px-5 py-3.5 text-base" : size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2.5 text-sm";
  return (
    <button
      className={`relative inline-flex select-none items-center justify-center gap-2 rounded-xl border-[3px] border-ink font-display font-extrabold
        shadow-[3px_3px_0_#1b1714] transition-[transform,box-shadow] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none
        disabled:cursor-not-allowed disabled:border-ink/25 disabled:bg-paper-dark disabled:text-ink/45 disabled:shadow-none disabled:active:translate-x-0 disabled:active:translate-y-0
        ${VAR[variant]} ${pad} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Pills / badges
// ---------------------------------------------------------------------------

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-xs font-bold ${className}`}>
      {children}
    </span>
  );
}

export const TIER_STYLE: Record<Tier, { bg: string; label: string }> = {
  Common: { bg: "bg-ink/10 text-ink", label: "Common" },
  Uncommon: { bg: "bg-teal/25 text-teal-ink", label: "Uncommon" },
  Rare: { bg: "bg-[#3b6ea5]/25 text-[#2c5680]", label: "Rare" },
  Epic: { bg: "bg-[#7b4ea3]/25 text-[#5d3a7e]", label: "Epic" },
  Legendary: { bg: "bg-gold/30 text-gold-ink", label: "Legendary" },
};

export function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier];
  return <Pill className={s.bg}>{s.label}</Pill>;
}

const HUNGER_STYLE: Record<Hunger, { bg: string; Icon: typeof Smiley; label: string }> = {
  // "full", not "fed": a freshly claimed or staked word starts full with nobody feeding it, and a
  // tester read "fed" as a claim that they had (decisions.md #13).
  fed: { bg: "bg-teal/20 text-teal-ink", Icon: Smiley, label: "full" },
  peckish: { bg: "bg-gold/25 text-gold-ink", Icon: SmileyMeh, label: "peckish" },
  hungry: { bg: "bg-candy/20 text-candy-ink", Icon: SmileyXEyes, label: "hungry" },
};
export function HungerBadge({ state }: { state: Hunger }) {
  const s = HUNGER_STYLE[state];
  return (
    <Pill className={s.bg}>
      <s.Icon weight="fill" size={12} /> {s.label}
    </Pill>
  );
}

// ---------------------------------------------------------------------------
// Meters / progress
// ---------------------------------------------------------------------------

/** Pity meter: shows the roll odds (45% base → 85% cap) with the current streak filled. */
export function PityMeter({ pity }: { pity: number }) {
  const prob = useGame().rollProb(pity);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-bold text-ink/70">
        <span>upgrade odds</span>
        <span className="font-display text-sm text-ink">{Math.round(prob * 100)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border-2 border-ink bg-paper-dark">
        <div className="h-full bg-teal transition-[width]" style={{ width: `${prob * 100}%` }} />
      </div>
      {pity > 0 && <div className="text-[11px] text-ink/60">pity +{pity} · resets on a hit</div>}
    </div>
  );
}

export function Bar({ value, max, className = "bg-gold" }: { value: number; max: number; className?: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full border-2 border-ink bg-paper-dark">
      <div className={`h-full transition-[width] ${className}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown to the next UTC midnight (client-only → no hydration mismatch)
// ---------------------------------------------------------------------------

/**
 * Time until the chain's day rolls over.
 *
 * UTC, not local. Both things this counts down to — the daily letter and the jackpot draw — reset on
 * `uint32(block.timestamp / 1 days)`, which is UTC days since epoch. `setHours(24,0,0,0)` counted to
 * LOCAL midnight, so for every player outside UTC it was wrong by their offset: someone in UTC-5
 * would be told the daily unlocks five hours after it already had, and someone in UTC+9 would be
 * invited to claim one the contract would reject with DailyAlreadyUsed.
 */
/** Milliseconds from `now` until the next UTC midnight. Exported for test. */
export function msUntilUtcMidnight(now: Date): number {
  const mid = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
  return mid - now.getTime();
}

/** `12h 34m 05s`. Exported for test. */
export function formatCountdown(ms: number): string {
  const clamped = Math.max(0, ms);
  const h = Math.floor(clamped / 3.6e6);
  const m = Math.floor((clamped % 3.6e6) / 6e4);
  const sec = Math.floor((clamped % 6e4) / 1000);
  return `${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`;
}

export function Countdown({ className = "" }: { className?: string }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const tick = () => {
      setLeft(formatCountdown(msUntilUtcMidnight(new Date())));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  return <span className={`tabular-nums ${className}`}>{left || "—"}</span>;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`cel rounded-2xl bg-paper p-4 ${className}`}>{children}</div>;
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between">
      <h2 className="font-display text-lg font-extrabold">{children}</h2>
      {action}
    </div>
  );
}

export function EmptyState({ Icon, title, sub }: { Icon: typeof Basket; title: string; sub?: string }) {
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-2xl border-[3px] border-dashed border-ink/30 px-4 py-8 text-center">
      <Icon size={32} weight="bold" className="text-ink/40" />
      <div className="font-display font-bold">{title}</div>
      {sub && <div className="max-w-[28ch] text-xs text-ink/60">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet (modal)
// ---------------------------------------------------------------------------

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    // Below md a bottom sheet (the phone idiom); from md a centered dialog, so a sheet never
    // stretches across a desktop window.
    <div className="absolute inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center md:p-6" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-ink/50" onClick={onClose} />
      {/* The bordered, rounded box never scrolls itself: only the body below the title bar does.
          When the box was the scroller, a browser that always shows scrollbars (Brave, or any
          macOS setup with a mouse) drew its track over the right border and the rounded corner. */}
      <div className="relative flex max-h-[88%] flex-col overflow-hidden rounded-t-3xl border-t-[3px] border-x-[3px] border-ink bg-paper shadow-[0_-6px_0_#1b1714] md:max-h-[85vh] md:w-full md:max-w-[560px] md:rounded-3xl md:border-[3px] md:shadow-[0_8px_0_#1b1714]">
        <div className="flex shrink-0 items-center justify-between border-b-2 border-ink/15 bg-paper px-4 py-3">
          <div className="font-display text-lg font-extrabold">{title}</div>
          <button
            onClick={onClose}
            className="hit-44 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink font-bold"
            aria-label="Close"
          >
            <X weight="bold" size={16} />
          </button>
        </div>
        {/* Default flex (0 1 auto), never flex-1: a 0% basis against the box's content-sized height
            collapses to 0 px in WebKit builds that treat it literally (iOS WKWebView, Bugbot on #115).
            Auto basis takes the content height and shrinks only when the box hits its max-height. */}
        <div className="ink-scroll min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 pt-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toaster — reads toasts from game state, auto-dismisses
// ---------------------------------------------------------------------------

const TOAST_TONE = {
  good: "bg-teal text-ink",
  bad: "bg-candy-deep text-paper",
  info: "bg-ink text-paper",
};

export function Toaster() {
  const { state, dismissToast, busy, dismissBusy } = useGame();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-4">
      {busy && <BusyPill busy={busy} onDismiss={dismissBusy} />}
      {state.toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={dismissToast} />
      ))}
    </div>
  );
}

const BUSY_PHASE: Record<Busy["phase"], string> = {
  preparing: "Getting it ready…",
  wallet: "Confirm in your wallet",
  working: "Waiting for the chain…",
};

/** A phase stuck this long gets a way out: the gate would otherwise refuse every later tap. */
const BUSY_DISMISS_AFTER_MS = 15_000;

/**
 * The status of the action in flight (lib/onchain/actionGate), from the tap until the last read.
 * It sits above the toasts and stays until the action settles. After a while in any one phase it
 * offers "Hide", for a request that never comes back: a phone wallet left unopened, a hung fetch.
 */
function BusyPill({ busy, onDismiss }: { busy: Busy; onDismiss: () => void }) {
  const [stale, setStale] = useState(false);
  useEffect(() => {
    setStale(false);
    const id = window.setTimeout(() => setStale(true), BUSY_DISMISS_AFTER_MS);
    return () => window.clearTimeout(id);
  }, [busy.phase, busy.label]);
  return (
    <div
      role="status"
      aria-live="polite"
      className="animate-pop pointer-events-auto flex max-w-full items-center gap-2.5 rounded-xl border-[3px] border-ink bg-paper px-3 py-2 text-sm shadow-[3px_3px_0_#1b1714]"
    >
      <CircleNotch weight="bold" size={18} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-bold">{busy.label}</span>
        <span className="block text-xs font-medium text-ink/60">{BUSY_PHASE[busy.phase]}</span>
      </span>
      {stale && (
        <button onClick={onDismiss} className="shrink-0 text-xs font-bold text-ink/50 underline">
          Hide
        </button>
      )}
    </div>
  );
}

/** Each toast owns an independent mount-timer, so adding/removing toasts never resets the others. */
function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  useEffect(() => {
    const id = window.setTimeout(() => onDone(toast.id), 2600);
    return () => window.clearTimeout(id);
  }, [toast.id, onDone]);
  return (
    <div
      className={`animate-pop pointer-events-auto max-w-full rounded-xl border-[3px] border-ink px-3 py-2 text-center text-sm font-bold shadow-[3px_3px_0_#1b1714] ${TOAST_TONE[toast.tone]}`}
    >
      {toast.text}
    </div>
  );
}
