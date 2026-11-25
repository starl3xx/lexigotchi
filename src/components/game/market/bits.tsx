"use client";
/** Small parts the Market's pages share: amounts, time, a quantity stepper, price ideas, a comparison line. */
import type { ReactNode } from "react";
import { versus, versusLabel, type PriceIdea } from "@/lib/market/deals";
import { fmtUsd, fmtWord, showsUsd, useGame } from "../state";

/** "2.40M $WORD", with dollars where the game shows them (never on a test network). */
export function useAmount(): (n: number) => string {
  const { state } = useGame();
  return (n) => (showsUsd(state) ? `${fmtWord(n)} $WORD (${fmtUsd(n)})` : `${fmtWord(n)} $WORD`);
}

/** "just now", "12 min ago", "3 h ago", "2 days ago". */
export function timeAgo(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.floor((now - at) / 60_000));
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} days ago`;
}

/** How many, between 1 and `max`. The buttons are a full 36 px for thumbs. */
export function Qty({ value, max, onChange, label }: { value: number; max: number; onChange: (n: number) => void; label: string }) {
  const step = (by: number) => onChange(Math.min(max, Math.max(1, value + by)));
  const btn = "press grid h-9 w-9 place-items-center rounded-lg border-2 border-ink bg-card font-display text-base font-extrabold disabled:border-ink/25 disabled:text-ink/30";
  return (
    <span className="inline-flex items-center gap-1.5" role="group" aria-label={label}>
      <button type="button" className={btn} onClick={() => step(-1)} disabled={value <= 1} aria-label="One fewer">
        −
      </button>
      <span className="min-w-6 text-center font-display text-sm font-extrabold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button type="button" className={btn} onClick={() => step(1)} disabled={value >= max} aria-label="One more">
        +
      </button>
    </span>
  );
}

/**
 * A price beside what the thing costs to make: "12% under what it costs to make". Under is the news
 * (teal, bold); over is only said.
 */
export function Versus({ price, reference, what = "what it costs to make" }: { price: number; reference: number | null | undefined; what?: string }) {
  const v = versus(price, reference);
  const label = versusLabel(v);
  if (v === null || !label) return null;
  return (
    <span className={v <= -0.03 ? "font-bold text-teal-ink" : "text-ink/60"}>
      {label[0].toUpperCase() + label.slice(1)} {what}
    </span>
  );
}

/** Prices to start from, each with its reason. Tapping one fills the price in. */
export function PriceIdeas({ ideas, current, onPick }: { ideas: readonly PriceIdea[]; current: number; onPick: (price: number) => void }) {
  if (ideas.length === 0) return null;
  return (
    <ul className="space-y-1">
      {ideas.map((i) => (
        <li key={i.label}>
          <button
            type="button"
            onClick={() => onPick(i.price)}
            aria-pressed={current === i.price}
            className={`press flex w-full items-center justify-between gap-3 rounded-lg border-2 px-2.5 py-1.5 text-left text-xs ${
              current === i.price ? "border-ink bg-ink text-paper" : "border-ink/25 bg-card text-ink/75"
            }`}
          >
            <span>{i.label}</span>
            <strong className="shrink-0 font-display tabular-nums">{fmtWord(i.price)}</strong>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** A whole-number $WORD price, typed with or without commas. */
export function PriceInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (text: string) => void; placeholder: string }) {
  return (
    <input
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-card px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-candy"
    />
  );
}
export const priceOf = (text: string) => Number(text.replace(/[^0-9]/g, ""));
export const priceText = (n: number) => n.toLocaleString("en-US");

/** A part of a Market page: a heading on a ruled line, never a box. */
export function Part({ title, aside, children, className = "" }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={className}>
      <div className="mb-2 flex items-baseline justify-between gap-3 border-b-[3px] border-ink pb-1">
        <h2 className="font-display text-base font-extrabold">{title}</h2>
        {aside && <span className="text-xs text-ink/55">{aside}</span>}
      </div>
      {children}
    </section>
  );
}
