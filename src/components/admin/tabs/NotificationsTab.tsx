"use client";
/**
 * Notifications — the preview surface for push.
 *
 * WHY THERE IS NO SEND BUTTON HERE. Every other operator action in this console is a transaction
 * BUILDER: the console composes it, the owner's wallet signs it, and the signature is the real
 * security boundary (see src/lib/admin/auth.ts — that's why the admin routes are unauthenticated
 * server-side and it's fine). A push has no signature. An endpoint that could send one would BE the
 * authority, unauthenticated, for an action that reaches every player's phone and cannot be
 * recalled. So sending lives where it has a real gate: the keeper CLI (`--notify`, `--announce`),
 * behind shell access, and the daily cron behind CRON_SECRET.
 *
 * What this tab is for is the thing that actually needed building — seeing exactly what a player
 * would receive, in the real character budget, before any of it is armed.
 */
import { useState } from "react";
import {
  hungerWarning,
  dailyReady,
  jackpotWon,
  jackpotRollover,
  earningsPaid,
  pityCapped,
  listingFilled,
  type Notification,
} from "@/lib/notify/templates";
import { clamp, LIMITS } from "@/lib/notify/limits"; // NOT ./send — see limits.ts
import { AdminCard, Banner, KeyVal, SectionLabel, StatusBadge, useFetch, Spinner } from "../ui";
import { Info, Megaphone, ShieldCheck, Warning } from "../icons";

interface StatusPayload {
  armed: boolean;
  blockers: string[];
  checks: { isProd: boolean; flagOn: boolean; hasKey: boolean };
  audience: number | null;
  audienceError: string | null;
  /** Every reminder channel: Farcaster, browser push, email (the route's ChannelStatus). */
  channels?: {
    key: string;
    label: string;
    on: boolean;
    detail: string;
    missing: string[];
    audience: number | null;
    audienceNote: string;
  }[];
}

const SAMPLE_HASH = "0x4f2c1d8e9a0b3c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5";

/** Every template, rendered with realistic data. `day` rotates the variants the way production does. */
function gallery(day: number): { kind: "nudge" | "receipt"; when: string; note: Notification }[] {
  return [
    { kind: "nudge", when: "keeper, daily — staked words near the hunger line", note: hungerWarning(3, 6, day) },
    { kind: "nudge", when: "cron 13:00 UTC — hasn't pulled, played in the last 7 days", note: dailyReady(day) },
    { kind: "receipt", when: "keeper — on a winning resolve", note: jackpotWon("cabin", "1,250,000 $WORD", day) },
    { kind: "nudge", when: "not yet wired — pot crossed a threshold", note: jackpotRollover("4,800,000 $WORD", day) },
    { kind: "receipt", when: "not yet wired — a payout paid the player’s words", note: earningsPaid("42,000 $WORD", day) },
    { kind: "nudge", when: "not yet wired — pity hit the 85% cap", note: pityCapped("q", day) },
    { kind: "receipt", when: "not yet wired — a Seaport listing filled", note: listingFilled("w", SAMPLE_HASH, day) },
  ];
}

function Count({ n, max }: { n: number; max: number }) {
  const tone = n > max ? "text-candy" : n > max * 0.9 ? "text-ink/80" : "text-ink/40";
  return (
    <span className={`font-mono text-[11px] font-bold ${tone}`}>
      {n}/{max}
    </span>
  );
}

/** One notification as the player's phone would show it, with the real budgets alongside. */
function Preview({ note }: { note: Notification }) {
  const title = clamp(note.title, LIMITS.title);
  const body = clamp(note.body, LIMITS.body);
  const truncated = title !== note.title || body !== note.body;
  return (
    <div className="rounded-xl border-[3px] border-ink bg-paper p-3">
      <div className="flex items-start justify-between gap-3">
        <span className="font-display text-sm font-extrabold leading-tight">{title}</span>
        <Count n={note.title.length} max={LIMITS.title} />
      </div>
      <div className="mt-1 flex items-start justify-between gap-3">
        <span className="text-xs leading-snug text-ink/75">{body}</span>
        <Count n={note.body.length} max={LIMITS.body} />
      </div>
      {truncated && (
        <div className="mt-2 text-[11px] font-bold text-candy">
          Clamped — this would arrive truncated. Shorten the template.
        </div>
      )}
      <div className="mt-2 font-mono text-[10px] text-ink/40">id: {note.notificationId}</div>
    </div>
  );
}

export function NotificationsTab() {
  const { data, loading, error } = useFetch<StatusPayload>("/api/admin/notify-status");
  // Rotate the preview through the same day-indexed variants production uses, so the operator can
  // page through the copy a player would actually see on consecutive days.
  const [day, setDay] = useState(() => Math.floor(Date.now() / 86_400_000));

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Megaphone weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Notifications</h2>
      </div>

      {loading && !data ? (
        <Spinner />
      ) : error || !data ? (
        // NEVER render a failed fetch as "inert". Absence of an answer is not the answer "off" —
        // reporting disarmed while push may well be armed is exactly backwards for the one screen
        // whose job is telling you whether sends can happen.
        <Banner tone="error" icon={<Warning weight="bold" size={14} />}>
          <span className="text-xs">
            <b>Status unavailable</b> — {error ?? "no response"}. This says nothing about whether push
            is armed; check the deploy&apos;s env directly before assuming it is off.
          </span>
        </Banner>
      ) : data.armed ? (
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          <span className="text-xs">
            <b>Farcaster push is ARMED.</b> Keeper and cron runs will reach real phones. A sent notification
            cannot be recalled.
          </span>
        </Banner>
      ) : (
        <Banner tone="ok" icon={<ShieldCheck weight="bold" size={14} />}>
          <span className="text-xs">
            <b>Farcaster push is inert</b>: nothing can send through Farcaster. {data?.blockers.join("; ")}.
          </span>
        </Banner>
      )}

      {data?.channels && (
        <AdminCard title="Every reminder channel">
          <p className="mb-2 text-xs text-ink/60">
            The keeper (00:05 UTC) sends hunger warnings on each channel that is on: Farcaster first, browser push for wallets
            Farcaster can&apos;t reach, and email to wallets that opted in. The 13:00 UTC cron sends the daily-letter reminder. Each
            channel has its own switch.
          </p>
          <div className="divide-y divide-ink/10">
            {data.channels.map((c) => (
              <div key={c.key} className="flex flex-wrap items-start justify-between gap-2 py-2">
                <div className="min-w-0 max-w-xl">
                  <div className="text-sm font-bold">{c.label}</div>
                  <div className="text-[11px] text-ink/55">{c.audienceNote}</div>
                  {!c.on && c.missing.length > 0 && (
                    <div className="mt-0.5 text-[11px] text-ink/70">
                      Needs: {c.missing.map((m) => <code key={m} className="mr-1.5">{m}</code>)}
                    </div>
                  )}
                </div>
                <StatusBadge tone={c.on ? "warning" : "ok"}>{c.on ? "sends for real" : "off"}</StatusBadge>
              </div>
            ))}
          </div>
        </AdminCard>
      )}

      <AdminCard title="Farcaster notifications">
        {!data && <SectionLabel>unknown — the status endpoint did not answer</SectionLabel>}
        <KeyVal k="Production deployment" v={!data ? "—" : data.checks.isProd ? "yes" : "no"} />
        <KeyVal k="NOTIFICATIONS_ENABLED" v={!data ? "—" : data.checks.flagOn ? '"true"' : "not set"} mono />
        <KeyVal k="NEYNAR_API_KEY" v={!data ? "—" : data.checks.hasKey ? "present" : "missing"} />
        <KeyVal
          k="Audience (added the mini app)"
          v={
            data?.audienceError
              ? `unavailable — ${data.audienceError}`
              : data?.audience == null
                ? "—"
                : `${data.audience} player${data.audience === 1 ? "" : "s"}`
          }
        />
        <div className="mt-3">
          <StatusBadge tone={!data ? "error" : data.armed ? "warning" : "ok"}>
            {!data ? "unknown" : data.armed ? "armed" : "inert"}
          </StatusBadge>
        </div>
      </AdminCard>

      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        <span className="text-xs">
          There is no send button here on purpose. Every other action in this console is signed by
          the owner wallet — a push has no signature, so an endpoint that could send one would be
          the entire authority for something irreversible. Sending lives in the keeper
          (<code>npm run keeper -- --notify</code>, <code>--announce</code>) and the daily cron.
        </span>
      </Banner>

      <AdminCard title="Copy preview">
        <SectionLabel>exactly what a phone would show — page days to see the rotation</SectionLabel>
        <div className="mb-3 flex items-center gap-2">
          <button
            onClick={() => setDay((d) => d - 1)}
            className="rounded-lg border-2 border-ink bg-paper px-2.5 py-1 text-xs font-bold active:translate-y-[1px]"
          >
            ← prev day
          </button>
          <span className="font-mono text-[11px] text-ink/50">epoch day {day}</span>
          <button
            onClick={() => setDay((d) => d + 1)}
            className="rounded-lg border-2 border-ink bg-paper px-2.5 py-1 text-xs font-bold active:translate-y-[1px]"
          >
            next day →
          </button>
        </div>

        <div className="space-y-3">
          {gallery(day).map(({ kind, when, note }, i) => (
            <div key={i}>
              <div className="mb-1 flex items-center gap-2">
                <StatusBadge tone={kind === "receipt" ? "accent" : "ok"}>{kind}</StatusBadge>
                <span className="text-[11px] text-ink/50">{when}</span>
              </div>
              <Preview note={note} />
            </div>
          ))}
        </div>
      </AdminCard>

      <AdminCard title="Why the two kinds differ">
        <p className="text-xs leading-relaxed text-ink/75">
          <b>Nudges</b> describe a state that is still true an hour later, so their id is keyed to the
          day — one per day is the intent, and a retried run is a safe no-op.{" "}
          <b>Receipts</b> describe a single event, so their id is keyed to that event (an order hash,
          a resolve). A receipt keyed by day would silently swallow the second one the same day, and
          the player would simply never be told.
        </p>
      </AdminCard>
    </div>
  );
}
