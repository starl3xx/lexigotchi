"use client";
/**
 * Players → "Reminders and accounts": for each player (linked wallets are one player), the accounts
 * they linked, the reminder channels they connected, and the kinds of reminder they changed
 * (starl3xx, 2026-11-27: "I wanna see on here /admin which notifications/reminders/accounts players
 * have connected"). Rows come from lib/admin/playerReach.ts, served by the gated players route.
 *
 * A fact that couldn't be read shows "?" and a dashed chip: unknown, never "no". Types only from
 * the server's modules (the Postgres driver must stay out of the browser bundle).
 */
import { useMemo, useState } from "react";
import type { PlayersPayload } from "@/lib/admin/playersData";
import type { ReachRow, ReachSummary } from "@/lib/admin/playerReach";
import { KIND_SHORT } from "@/lib/admin/kindLabels";
import { REMINDER_KINDS } from "@/lib/notify/kinds";
import { basescanAddress, fmtNum, shortAddr } from "@/lib/admin/format";
import { AdminCard, Banner, SectionLabel, StatusBadge, Toggle } from "../ui";
import { Warning } from "../icons";

type Reach = PlayersPayload["reach"];
type ChannelKey = keyof Reach["channelsOn"];

/** "Nov 24": enough for a list of players. */
function day(iso: string | null): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function Chip({ children, tone = "plain", title }: { children: React.ReactNode; tone?: "plain" | "unknown" | "off" | "warn"; title?: string }) {
  const cls = {
    plain: "border-ink bg-card",
    warn: "border-ink bg-gold/30",
    unknown: "border-dashed border-ink/40 bg-transparent text-ink/50",
    off: "border-ink/30 bg-transparent text-ink/45 line-through",
  }[tone];
  return (
    <span title={title} className={`inline-flex items-center whitespace-nowrap rounded-full border-2 px-1.5 py-px text-[11px] font-bold ${cls}`}>
      {children}
    </span>
  );
}

const UNKNOWN_TITLE = "Couldn’t be read just now: unknown, not no";
const OFF_TITLE = "Connected, but this channel is switched off for everyone";

/** A count, or "?" when some player's answer couldn't be read. */
const n = (v: number | null) => (v === null ? "?" : fmtNum(v));

export function PlayerReach({ reach, showTeam, farcasterUsers }: { reach: Reach; showTeam: boolean; farcasterUsers: number | null }) {
  const [everyone, setEveryone] = useState(false);
  const players = useMemo(() => reach.rows.filter((r) => showTeam || !r.operator), [reach.rows, showTeam]);
  const shown = useMemo(() => (everyone ? players : players.filter((r) => r.connected)), [players, everyone]);
  const nothing = players.length - players.filter((r) => r.connected).length;

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionLabel>
          Reminders and accounts · by player · {fmtNum(shown.length)} shown
        </SectionLabel>
        {nothing > 0 && <Toggle checked={everyone} onChange={setEveryone} label={`Show players with nothing connected (${nothing})`} />}
      </div>
      {reach.unread.length > 0 && (
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          Couldn’t read {reach.unread.join(", ")} just now. Those show “?” below: unknown, not no. Refresh to try again.
        </Banner>
      )}
      <SummaryCard summary={reach.summary} on={reach.channelsOn} farcasterUsers={farcasterUsers} />
      <ReachTable rows={shown} on={reach.channelsOn} />
    </section>
  );
}

function SummaryCard({ summary: s, on, farcasterUsers }: { summary: ReachSummary; on: Reach["channelsOn"]; farcasterUsers: number | null }) {
  const line = (label: string, value: number | null, extra?: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="font-bold">{label}</span>
      <span className="text-right font-mono font-bold tabular-nums">
        {n(value)}
        {extra}
      </span>
    </div>
  );
  const offBadge = (k: ChannelKey) => (on[k] ? null : <span className="ml-1.5 font-sans text-[11px] font-bold text-candy">off for everyone</span>);
  return (
    <AdminCard title={`What players connected · of ${fmtNum(s.players)} players, the team’s left out`}>
      <div className="grid gap-5 md:grid-cols-3">
        <div className="space-y-1">
          <SectionLabel>Linked accounts</SectionLabel>
          {line("Farcaster", s.accounts.farcaster)}
          {line("X", s.accounts.x)}
          {line("Email (confirmed)", s.accounts.email)}
          {line("Telegram", s.accounts.telegram)}
          {line("Coinbase verified", s.accounts.coinbase)}
          {line("Two or more wallets", s.accounts.wallets)}
        </div>
        <div className="space-y-1">
          <SectionLabel>Reminders can reach them by</SectionLabel>
          {line("Farcaster (added the mini app)", s.channels.farcasterApp, offBadge("farcaster"))}
          {line("Browser push", s.channels.browsers, offBadge("browser"))}
          {line("Email reminders", s.channels.email, offBadge("email"))}
          {line("· one email a week", s.channels.weekly)}
          {line("Telegram", s.channels.telegram, offBadge("telegram"))}
          {line("At least one of these", s.channels.any)}
        </div>
        <div className="space-y-1">
          <SectionLabel>Kinds · players who keep each on</SectionLabel>
          {s.kinds ? (
            REMINDER_KINDS.map((k) => (
              <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-bold">{KIND_SHORT[k]}</span>
                <span className="text-right font-mono font-bold tabular-nums">
                  {fmtNum(s.kinds![k].getting)}
                  {s.kinds![k].changed > 0 && <span className="ml-1.5 font-sans text-[11px] font-bold text-ink/50">{s.kinds![k].changed} changed</span>}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-ink/50">? The reminder choices couldn’t be read.</p>
          )}
        </div>
      </div>
      <p className="mt-4 text-[11px] text-ink/50">
        Farcaster comes first: a player it can reach gets pushes there, and their browsers only when it can’t. “Added the mini app” is what the game
        knows; a player can still mute notifications inside Farcaster. These are players (linked wallets as one) the console has seen
        {farcasterUsers != null ? `, so Farcaster can be fewer than the ${fmtNum(farcasterUsers)} Farcaster players above, which counts every id that opened the mini app` : ""}.
      </p>
    </AdminCard>
  );
}

function AccountChips({ r }: { r: ReachRow }) {
  const a = r.accounts;
  const chips: React.ReactNode[] = [];
  if (a.farcaster === null) chips.push(<Chip key="fc" tone="unknown" title={UNKNOWN_TITLE}>Farcaster ?</Chip>);
  else if (a.farcaster.length) chips.push(<Chip key="fc">Farcaster {a.farcaster.map((f) => `#${f}`).join(", ")}</Chip>);
  if (a.x === null) chips.push(<Chip key="x" tone="unknown" title={UNKNOWN_TITLE}>X ?</Chip>);
  else if (a.x) chips.push(<Chip key="x">X @{a.x}</Chip>);
  if (a.email === null) chips.push(<Chip key="em" tone="unknown" title={UNKNOWN_TITLE}>Email ?</Chip>);
  else if (a.email) chips.push(<Chip key="em">Email</Chip>);
  if (a.telegram === null) chips.push(<Chip key="tg" tone="unknown" title={UNKNOWN_TITLE}>Telegram ?</Chip>);
  else if (a.telegram) chips.push(<Chip key="tg">Telegram</Chip>);
  if (a.coinbase === null) chips.push(<Chip key="cb" tone="unknown" title={UNKNOWN_TITLE}>Coinbase ?</Chip>);
  else if (a.coinbase) chips.push(<Chip key="cb">Coinbase verified</Chip>);
  return chips.length ? <div className="flex flex-wrap gap-1">{chips}</div> : <span className="text-ink/45">–</span>;
}

function ChannelChips({ r, on }: { r: ReachRow; on: Reach["channelsOn"] }) {
  const c = r.channels;
  const chips: React.ReactNode[] = [];
  const add = (key: string, channel: ChannelKey, v: boolean | null, label: string) => {
    if (v === null) chips.push(<Chip key={key} tone="unknown" title={UNKNOWN_TITLE}>{label} ?</Chip>);
    else if (v)
      chips.push(
        <Chip key={key} tone={on[channel] ? "plain" : "off"} title={on[channel] ? undefined : OFF_TITLE}>
          {label}
        </Chip>,
      );
  };
  add("fc", "farcaster", c.farcasterApp, "Farcaster app");
  if (c.browsers === null) chips.push(<Chip key="br" tone="unknown" title={UNKNOWN_TITLE}>Browser ?</Chip>);
  else if (c.browsers > 0)
    chips.push(
      <Chip key="br" tone={on.browser ? "plain" : "off"} title={on.browser ? undefined : OFF_TITLE}>
        Browser ×{c.browsers}
      </Chip>,
    );
  add("em", "email", c.email, r.emailCadence === "weekly" ? "Email · weekly" : "Email");
  add("tg", "telegram", c.telegram, "Telegram");
  return chips.length ? <div className="flex flex-wrap gap-1">{chips}</div> : <span className="text-ink/45">none</span>;
}

function KindChips({ r }: { r: ReachRow }) {
  if (r.kinds === null) return <Chip tone="unknown" title={UNKNOWN_TITLE}>?</Chip>;
  if (r.changed.length === 0) return <span className="text-ink/45">the defaults</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {r.changed.map((k) => (
        <Chip key={k} tone={r.kinds![k] ? "plain" : "warn"} title={r.kinds![k] ? "Turned on (off by default)" : "Turned off (on by default)"}>
          {r.kinds![k] ? "+" : "−"} {KIND_SHORT[k]}
        </Chip>
      ))}
    </div>
  );
}

function ReachTable({ rows, on }: { rows: ReachRow[]; on: Reach["channelsOn"] }) {
  if (rows.length === 0) {
    return (
      <AdminCard>
        <p className="text-sm text-ink/60">No player has connected anything yet.</p>
      </AdminCard>
    );
  }
  return (
    <div className="cel overflow-x-auto rounded-2xl bg-paper">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="border-b-2 border-ink text-[11px] text-ink/55">
          <tr>
            <th className="px-3 py-2 font-bold">Player</th>
            <th className="px-3 py-2 font-bold">Linked accounts</th>
            <th className="px-3 py-2 font-bold">Reminders by</th>
            <th className="px-3 py-2 font-bold">Reminder choices</th>
            <th className="px-3 py-2 font-bold">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.account} className={`border-b border-ink/10 align-top ${r.operator ? "bg-paper-dark/40" : ""}`}>
              <td className="px-3 py-2">
                <div className="flex items-center gap-2">
                  {r.pfpUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.pfpUrl} alt="" className="h-6 w-6 rounded-full border-2 border-ink object-cover" />
                  ) : (
                    <span className="h-6 w-6 rounded-full border-2 border-ink bg-paper-dark" />
                  )}
                  <div className="min-w-0">
                    <div className="font-bold">{r.name ? `@${r.name}` : shortAddr(r.account)}</div>
                    {r.wallets.map((w) => (
                      <a key={w} href={basescanAddress(w)} target="_blank" rel="noreferrer" className="block font-mono text-[11px] text-ink/50 underline">
                        {shortAddr(w)}
                      </a>
                    ))}
                  </div>
                </div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {r.operator && <StatusBadge tone="accent">team</StatusBadge>}
                  {r.wallets.length > 1 && <Chip>{r.wallets.length} wallets</Chip>}
                </div>
              </td>
              <td className="px-3 py-2">
                <AccountChips r={r} />
              </td>
              <td className="px-3 py-2">
                <ChannelChips r={r} on={on} />
              </td>
              <td className="px-3 py-2">
                <KindChips r={r} />
              </td>
              <td className="px-3 py-2 whitespace-nowrap">{day(r.lastSeen)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
