"use client";
/** Shared rubber-hose UI primitives for the play prototype — cel borders, hard shadows, wood tiles. */
import { createContext, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Tier } from "@/lib/economy";
import { Basket, CheckCircle, CircleNotch, Info, Smiley, SmileyMeh, SmileyXEyes, WarningCircle, X } from "./ui/icons";
import { useGame, type Hunger, type Toast } from "./state";
import { useTween } from "./useTween";
import { TierMark } from "./TierMark";
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
  ghost: "bg-card text-ink",
  danger: "bg-card text-candy-ink",
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
        press [--sh:3px] [box-shadow:3px_3px_0_#1b1714]
        disabled:cursor-not-allowed disabled:border-ink/25 disabled:bg-paper-dark disabled:text-ink/40 disabled:shadow-none
        ${VAR[variant]} ${pad} ${full ? "w-full" : ""} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Segmented — a two- or three-way switch. One ink thumb slides between the options ("you are
// here" is ink, CLAUDE.md), so the change reads as one thing moving, not two buttons repainting.
// ---------------------------------------------------------------------------

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  className = "",
}: {
  value: T;
  options: { value: T; label: ReactNode; disabled?: boolean }[];
  onChange: (v: T) => void;
  className?: string;
}) {
  const at = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className={`relative flex rounded-xl border-[3px] border-ink bg-card p-1 text-sm font-medium ${className}`}>
      <span
        aria-hidden
        className="seg-thumb absolute inset-y-1 left-1 rounded-lg bg-ink"
        style={{ width: `calc((100% - 0.5rem) / ${options.length})`, transform: `translateX(${at * 100}%)` }}
      />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            className={`relative flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 transition-colors duration-200 disabled:opacity-40 ${
              on ? "text-paper" : "text-ink/70 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// TweenNumber — a balance or pot that counts to its new value and tints for a moment (useTween).
// ---------------------------------------------------------------------------

export function TweenNumber({ value, format, className = "" }: { value: number; format: (n: number) => string; className?: string }) {
  const { value: shown, delta } = useTween(value);
  return (
    <span data-delta={delta ?? undefined} className={`tween tabular-nums ${className}`}>
      {format(shown)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pills / badges
// ---------------------------------------------------------------------------

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-xs font-medium ${className}`}>
      {children}
    </span>
  );
}

export const TIER_STYLE: Record<Tier, { bg: string; label: string }> = {
  Common: { bg: "bg-ink/10 text-ink", label: "Common" },
  Uncommon: { bg: "bg-teal/25 text-teal-ink", label: "Uncommon" },
  Rare: { bg: "bg-[#3b6ea5]/25 text-[#2c5680]", label: "Rare" },
  Legendary: { bg: "bg-gold/30 text-gold-ink", label: "Legendary" },
  Mythic: { bg: "bg-[#7b4ea3]/25 text-[#5d3a7e]", label: "Mythic" },
};

/** A word's rarity in a list: the tier's mark (./TierMark: a bead, then three to six corners) and its name. */
export function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier];
  return (
    <Pill className={s.bg}>
      <TierMark tier={tier} size={12} /> {s.label}
    </Pill>
  );
}

const HUNGER_STYLE: Record<Hunger, { bg: string; Icon: typeof Smiley; label: string }> = {
  // The player's words for the code's three states (decisions.md #63): awake, sleepy, asleep.
  fed: { bg: "bg-teal/20 text-teal-ink", Icon: Smiley, label: "awake" },
  peckish: { bg: "bg-gold/25 text-gold-ink", Icon: SmileyMeh, label: "sleepy" },
  hungry: { bg: "bg-candy/20 text-candy-ink", Icon: SmileyXEyes, label: "asleep" },
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

/** Pity meter: shows the roll odds (params.ts: 40% first try, +15 per miss, 85% cap) for the current streak. */
export function PityMeter({ pity }: { pity: number }) {
  const prob = useGame().rollProb(pity);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs font-medium text-ink/70">
        <span>roll odds</span>
        <span className="font-display text-sm text-ink">{Math.round(prob * 100)}%</span>
      </div>
      <div className="h-3 overflow-hidden rounded-full border-2 border-ink bg-paper-dark">
        <div className="h-full bg-teal transition-[width]" style={{ width: `${prob * 100}%` }} />
      </div>
      {pity > 0 && <div className="text-xs text-ink/70">pity +{pity} · resets on a hit</div>}
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
  return <span className={`tabular-nums ${className}`}>{left || "–"}</span>;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

/**
 * A card's flat tint (tailwind.config.ts, `wash`): the hue of what the box is about, thinned into
 * the card's own colour. It takes the place of `bg-card`, never sits beside it (two background
 * colours on one element are settled by the stylesheet's order, not by which is written last).
 * Flat, never a fade: decisions.md #66.
 */
export type Tint = "gold" | "teal" | "candy";
export const TINT: Record<Tint, string> = { gold: "bg-wash-gold", teal: "bg-wash-teal", candy: "bg-wash-candy" };

export function Card({ children, className = "", tint }: { children: ReactNode; className?: string; tint?: Tint }) {
  return <div className={`cel rounded-2xl ${tint ? TINT[tint] : "bg-card"} p-4 ${className}`}>{children}</div>;
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
      <div className="font-display font-medium">{title}</div>
      {sub && <div className="max-w-[28ch] text-xs text-ink/70">{sub}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet (modal)
// ---------------------------------------------------------------------------

/** True while the sheet host plays a closed sheet's exit (GameApp's SheetHost). */
export const SheetClosing = createContext(false);
/** How long SheetHost keeps a closed sheet mounted for its exit (globals.css, data-sheet). */
export const SHEET_EXIT_MS = 220;

export function Sheet({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  /**
   * A wider dialog on a computer, for a sheet whose point is a picture seen large (a Shop item's
   * view). A phone's bottom sheet is the screen's width either way.
   */
  wide?: boolean;
}) {
  const closing = useContext(SheetClosing);
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    // Two frames: paint the entering pose first, then transition from it (globals.css, data-sheet).
    let b = 0;
    const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setEntered(true))));
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, []);
  // Escape closes, as any desktop dialog does.
  useEffect(() => {
    if (!open || closing) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closing, onClose]);
  if (!open) return null;
  return (
    // Below md a bottom sheet (the phone idiom); from md a centered dialog, so a sheet never
    // stretches across a desktop window. It slides up (phone) or settles in (desktop), and on close
    // leaves faster than it came, while SheetHost keeps it mounted for the exit.
    <div
      data-sheet={closing ? "closing" : entered ? "open" : "enter"}
      className="absolute inset-0 z-40 flex flex-col justify-end md:items-center md:justify-center md:p-6"
      role="dialog"
      aria-modal="true"
    >
      <button aria-label="Close" className="sheet-backdrop absolute inset-0 bg-ink/50" onClick={onClose} />
      {/* The bordered, rounded box never scrolls itself: only the body below the title bar does.
          When the box was the scroller, a browser that always shows scrollbars (Brave, or any
          macOS setup with a mouse) drew its track over the right border and the rounded corner. */}
      <div
        className={`sheet-panel relative flex max-h-[88%] flex-col overflow-hidden rounded-t-3xl border-t-[3px] border-x-[3px] border-ink bg-paper shadow-[0_-6px_0_#1b1714] md:max-h-[85vh] md:w-full md:rounded-3xl md:border-[3px] md:shadow-[0_8px_0_#1b1714] ${wide ? "md:max-w-[720px] lg:max-w-[1000px]" : "md:max-w-[560px]"}`}
      >
        <div className="flex shrink-0 items-center justify-between border-b-2 border-ink/15 bg-paper px-4 py-3">
          <div className="font-display text-lg font-extrabold">{title}</div>
          <button
            onClick={onClose}
            className="hit-44 round-btn flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink font-medium"
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
  good: { cls: "bg-teal text-ink", Icon: CheckCircle },
  bad: { cls: "bg-candy-deep text-paper", Icon: WarningCircle },
  info: { cls: "bg-ink text-paper", Icon: Info },
};

/** Long enough to read: a short "Cancelled" goes quickly, "ABATE is staked. It’s in the daily
 *  jackpot." stays a little longer. */
export function toastMs(text: string): number {
  return Math.min(6000, Math.max(2800, 1400 + text.length * 45));
}
/** The exit runs this long before the toast is removed (globals.css, [data-toast="exit"]). */
const TOAST_EXIT_MS = 180;

export function Toaster() {
  const { state, dismissToast, busy, dismissBusy } = useGame();
  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-4">
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
      className="animate-pop pointer-events-auto flex max-w-full items-center gap-2.5 rounded-xl border-[3px] border-ink bg-card px-3 py-2 text-sm shadow-[3px_3px_0_#1b1714]"
    >
      <CircleNotch weight="bold" size={18} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
      <span className="min-w-0 leading-tight">
        <span className="block truncate font-medium">{busy.label}</span>
        <span className="block text-xs font-medium text-ink/70">{BUSY_PHASE[busy.phase]}</span>
      </span>
      {stale && (
        <button onClick={onDismiss} className="shrink-0 text-xs font-medium text-ink/70 underline">
          Hide
        </button>
      )}
    </div>
  );
}

/**
 * One toast. It slides in, waits long enough to read (toastMs), and slides out; pointing at it
 * holds it, a click dismisses it, and a hidden tab doesn't run its clock. Each toast owns its
 * timer, so adding or removing one never resets the others.
 */
function ToastItem({ toast, onDone }: { toast: Toast; onDone: (id: number) => void }) {
  const [phase, setPhase] = useState<"enter" | "open" | "exit">("enter");
  // A toast that arrives while the tab is hidden starts held: a phone player confirming in their
  // wallet app would otherwise come back to a result that ran out while they were away.
  const [held, setHeld] = useState(() => typeof document !== "undefined" && document.hidden);
  const left = useRef(toast.ms ?? toastMs(toast.text));
  useEffect(() => {
    // Two frames: the first paints the entering pose, the second starts the transition from it.
    let b = 0;
    const a = requestAnimationFrame(() => (b = requestAnimationFrame(() => setPhase("open"))));
    return () => {
      cancelAnimationFrame(a);
      cancelAnimationFrame(b);
    };
  }, []);
  useEffect(() => {
    if (phase === "exit") {
      const id = window.setTimeout(() => onDone(toast.id), TOAST_EXIT_MS);
      return () => window.clearTimeout(id);
    }
    if (held) return;
    const started = Date.now();
    const id = window.setTimeout(() => setPhase("exit"), left.current);
    // Hiding the tab only marks the toast held; this effect's cleanup (which runs because `held`
    // changed) clears the timer and banks the time already shown, once. Banking it here as well
    // counted the same span twice (Bugbot on #128).
    const onVis = () => {
      if (document.hidden) setHeld(true);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearTimeout(id);
      left.current = Math.max(800, left.current - (Date.now() - started));
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [phase, held, toast.id, onDone]);
  // A hidden tab holds the toast; coming back lets it run again.
  useEffect(() => {
    if (!held) return;
    const onVis = () => !document.hidden && setHeld(false);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [held]);
  const tone = TOAST_TONE[toast.tone];
  return (
    <button
      type="button"
      data-toast={phase}
      onClick={() => setPhase("exit")}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      title="Dismiss"
      className={`toast pointer-events-auto flex max-w-full items-center gap-2 rounded-xl border-[3px] border-ink px-3 py-2 text-left text-sm font-medium shadow-[3px_3px_0_#1b1714] ${tone.cls}`}
    >
      <tone.Icon weight="fill" size={18} className="shrink-0" aria-hidden />
      <span>{toast.text}</span>
    </button>
  );
}
