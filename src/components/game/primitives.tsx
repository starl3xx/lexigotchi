"use client";
/** Shared rubber-hose UI primitives for the play prototype — cel borders, hard shadows, wood tiles. */
import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { Tier } from "@/lib/economy";
import { Basket, Smiley, SmileyMeh, SmileyXEyes, X } from "./ui/icons";
import { useGame, type Hunger, type Toast } from "./state";

// ---------------------------------------------------------------------------
// Button — tactile cel button (the shadow "presses" on tap)
// ---------------------------------------------------------------------------

type Variant = "primary" | "gold" | "teal" | "ghost" | "danger";
const VAR: Record<Variant, string> = {
  primary: "bg-candy text-paper",
  gold: "bg-gold text-ink",
  teal: "bg-teal text-paper",
  ghost: "bg-paper text-ink",
  danger: "bg-paper text-candy",
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
        shadow-[3px_3px_0_#1b1714] transition-all active:translate-x-[3px] active:translate-y-[3px] active:shadow-none
        disabled:cursor-not-allowed disabled:opacity-40 disabled:active:translate-x-0 disabled:active:translate-y-0 disabled:active:shadow-[3px_3px_0_#1b1714]
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
    <span className={`inline-flex items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-xs font-bold ${className}`}>
      {children}
    </span>
  );
}

export const TIER_STYLE: Record<Tier, { bg: string; label: string }> = {
  Common: { bg: "bg-ink/10 text-ink", label: "Common" },
  Uncommon: { bg: "bg-teal/25 text-teal", label: "Uncommon" },
  Rare: { bg: "bg-[#3b6ea5]/25 text-[#2c5680]", label: "Rare" },
  Epic: { bg: "bg-[#7b4ea3]/25 text-[#5d3a7e]", label: "Epic" },
  Legendary: { bg: "bg-gold/30 text-gold-deep", label: "Legendary" },
};

export function TierBadge({ tier }: { tier: Tier }) {
  const s = TIER_STYLE[tier];
  return <Pill className={s.bg}>{s.label}</Pill>;
}

const HUNGER_STYLE: Record<Hunger, { bg: string; Icon: typeof Smiley; label: string }> = {
  fed: { bg: "bg-teal/20 text-teal", Icon: Smiley, label: "fed" },
  peckish: { bg: "bg-gold/25 text-gold-deep", Icon: SmileyMeh, label: "peckish" },
  hungry: { bg: "bg-candy/20 text-candy", Icon: SmileyXEyes, label: "hungry" },
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
        <div className="h-full bg-teal transition-all" style={{ width: `${prob * 100}%` }} />
      </div>
      {pity > 0 && <div className="text-[11px] text-ink/60">pity +{pity} · resets on a hit</div>}
    </div>
  );
}

export function Bar({ value, max, className = "bg-gold" }: { value: number; max: number; className?: string }) {
  return (
    <div className="h-2.5 overflow-hidden rounded-full border-2 border-ink bg-paper-dark">
      <div className={`h-full transition-all ${className}`} style={{ width: `${Math.min(100, (value / max) * 100)}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Countdown to next local midnight (client-only → no hydration mismatch)
// ---------------------------------------------------------------------------

export function Countdown({ className = "" }: { className?: string }) {
  const [left, setLeft] = useState("");
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      const mid = new Date(now);
      mid.setHours(24, 0, 0, 0);
      const ms = mid.getTime() - now.getTime();
      const h = Math.floor(ms / 3.6e6);
      const m = Math.floor((ms % 3.6e6) / 6e4);
      const sec = Math.floor((ms % 6e4) / 1000);
      setLeft(`${h}h ${String(m).padStart(2, "0")}m ${String(sec).padStart(2, "0")}s`);
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
    <div className="absolute inset-0 z-40 flex flex-col justify-end" role="dialog" aria-modal="true">
      <button aria-label="Close" className="absolute inset-0 bg-ink/50" onClick={onClose} />
      <div className="relative max-h-[88%] overflow-y-auto rounded-t-3xl border-t-[3px] border-x-[3px] border-ink bg-paper pb-6 shadow-[0_-6px_0_#1b1714]">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b-2 border-ink/15 bg-paper/95 px-4 py-3 backdrop-blur">
          <div className="font-display text-lg font-extrabold">{title}</div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink font-bold"
            aria-label="Close"
          >
            <X weight="bold" size={16} />
          </button>
        </div>
        <div className="px-4 pt-4">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toaster — reads toasts from game state, auto-dismisses
// ---------------------------------------------------------------------------

const TOAST_TONE = {
  good: "bg-teal text-paper",
  bad: "bg-candy text-paper",
  info: "bg-ink text-paper",
};

export function Toaster() {
  const { state, dismissToast } = useGame();
  return (
    <div className="pointer-events-none absolute inset-x-0 top-2 z-50 flex flex-col items-center gap-2 px-4">
      {state.toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDone={dismissToast} />
      ))}
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
