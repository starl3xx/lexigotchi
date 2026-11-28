"use client";
/**
 * Players — every player the game has seen (linked wallets are one player), and how far each got. Live: the contracts' events,
 * what each wallet holds now, and the database's sightings, profiles, and reminders
 * (lib/admin/playersData.ts). Gated on the server (useAdminApi), because it says who visited and when.
 *
 * The team's own wallets (the console's allowlist, the registry's roles, the server's keys) are
 * marked and left out of every count, so the numbers are testers only.
 *
 * Linked accounts, reminder channels, and reminder choices are per PLAYER (PlayerReach.tsx), never
 * in the wallet table: they belong to the account, so a linked wallet's row would disagree.
 */
import { useMemo, useState } from "react";
import type { PlayersPayload } from "@/lib/admin/playersData";
import type { Funnel, PlayerGroup } from "@/lib/admin/playerRows";
import { basescanAddress, fmtNum, shortAddr } from "@/lib/admin/format";
import { useAdminApi } from "../useAdminApi";
import { GatedState } from "../GatedState";
import { AdminCard, Banner, ErrorState, MetricCard, RefreshButton, SectionLabel, Spinner, StatusBadge, Toggle } from "../ui";
import { Info, Plugs, TelegramLogo, Users, UserList, Warning } from "../icons";
import { PlayerReach } from "./PlayerReach";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Nov 24, 19:05 UTC": the console works in UTC, like the game's day. */
export function whenUtc(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hh}:${mm} UTC`;
}

/** "4 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string | null, now: number): string {
  if (!iso) return "–";
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

const FUNNEL_STEPS: { key: keyof Funnel; label: string; note?: string; testnetOnly?: boolean }[] = [
  { key: "seen", label: "Seen connecting", note: "the game reports it; unverified" },
  { key: "faucet", label: "Took test $WORD", testnetOnly: true },
  { key: "letters", label: "Got letters", note: "a pack or a daily letter" },
  { key: "words", label: "Claimed a word" },
  { key: "rolls", label: "Rolled a letter" },
  { key: "staked", label: "Staked a word" },
  { key: "linkedX", label: "Linked X" },
  { key: "email", label: "Confirmed an email" },
  { key: "reminders", label: "Turned on reminders", note: "email, browser push, or Telegram" },
  { key: "telegram", label: "Linked Telegram", note: "for reminders from the bot" },
  { key: "listings", label: "Listed on the Market" },
];

export function PlayersTab() {
  const api = useAdminApi<PlayersPayload>("/api/admin/players");
  const [showTeam, setShowTeam] = useState(false);
  const data = api.data;
  const players = useMemo(() => (data?.players ?? []).filter((p) => showTeam || !p.operator), [data, showTeam]);
  const teamCount = data?.players.filter((p) => p.operator).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <UserList weight="bold" size={18} />
          <h2 className="font-display text-lg font-extrabold">Players</h2>
          {data && <span className="text-xs text-ink/50">as of {whenUtc(new Date(data.at).toISOString())} · {data.network.name}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {teamCount > 0 && <Toggle checked={showTeam} onChange={setShowTeam} label={`Show the team (${teamCount})`} />}
          <RefreshButton onClick={() => api.reload(true)} loading={api.loading} />
        </div>
      </div>

      {api.refusal ? (
        <GatedState
          refusal={api.refusal}
          canSignIn={api.canSignIn}
          signIn={api.signIn}
          signingIn={api.signingIn}
          signInError={api.signInError}
          address={api.address}
        />
      ) : api.loading && !data ? (
        <Spinner />
      ) : api.error && !data ? (
        <ErrorState msg={api.error} onRetry={() => api.reload(true)} />
      ) : data ? (
        <>
          <SourceBanners data={data} />

          <section>
            <SectionLabel>Testers · counted by player (linked wallets are one) · the team left out</SectionLabel>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <MetricCard
                icon={<TelegramLogo weight="bold" size={14} />}
                label="In the beta group"
                tone="accent"
                value={data.telegram.members == null ? "–" : fmtNum(data.telegram.members)}
                sub={data.telegram.members == null ? "bot not configured here" : "Telegram members, you and the bot included"}
              />
              <MetricCard
                icon={<Users weight="bold" size={14} />}
                label="Players"
                value={fmtNum(data.funnel.any)}
                sub={`${fmtNum(data.wallets)} wallets · ${data.newPlayers.day} new today · ${data.newPlayers.week} this week`}
              />
              <MetricCard
                icon={<Plugs weight="bold" size={14} />}
                label="Seen connecting"
                value={data.sources.sightings === "ok" ? fmtNum(data.funnel.seen) : "–"}
                sub={data.sources.sightings === "ok" ? "unverified: the game reports it" : "needs migration 0012"}
              />
              <MetricCard
                icon={<Users weight="bold" size={14} />}
                label="Farcaster players"
                value={data.farcaster ? fmtNum(data.farcaster.users) : "–"}
                sub={data.farcaster ? `${data.farcaster.added} added the mini app` : "database not readable"}
              />
            </div>
          </section>

          <FunnelCard funnel={data.funnel} testnet={data.network.isTestnet} sightingsOk={data.sources.sightings === "ok"} />

          {data.reach && <PlayerReach reach={data.reach} showTeam={showTeam} farcasterUsers={data.farcaster?.users ?? null} />}

          <section className="space-y-2">
            <SectionLabel>
              Every player · {fmtNum(players.length)} shown · most recent first
            </SectionLabel>
            <PlayerTable rows={players} now={data.at} testnet={data.network.isTestnet} />
          </section>
        </>
      ) : null}
    </div>
  );
}

function SourceBanners({ data }: { data: PlayersPayload }) {
  const s = data.sources;
  return (
    <div className="space-y-2">
      {s.sightings === "not_migrated" && (
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          Wallets that connect and then do nothing aren&apos;t counted yet. Apply migration 0012 (<code>npm run db:migrate</code>) and the
          game starts reporting them.
        </Banner>
      )}
      {s.chain === "error" && (
        <Banner tone="error" icon={<Warning weight="bold" size={14} />}>
          The chain scan failed, so onchain actions and holdings are missing below. Refresh to try again.
        </Banner>
      )}
      {s.chain === "no_deployment" && (
        <Banner tone="warning" icon={<Info weight="bold" size={14} />}>
          No game contracts on {data.network.name}, so there are no onchain actions to show.
        </Banner>
      )}
      {(s.database === "error" || s.database === "no_database") && (
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          {s.database === "no_database" ? "No database here (DATABASE_URL unset)" : "The database didn’t answer"}: sightings, profiles, and
          reminders are missing below.
        </Banner>
      )}
    </div>
  );
}

function FunnelCard({ funnel, testnet, sightingsOk }: { funnel: Funnel; testnet: boolean; sightingsOk: boolean }) {
  const top = Math.max(1, funnel.any);
  const steps = FUNNEL_STEPS.filter((s) => !s.testnetOnly || testnet).filter((s) => s.key !== "seen" || sightingsOk);
  return (
    <AdminCard title={`How far testers got · of ${fmtNum(funnel.any)} players`}>
      <div className="space-y-1.5">
        {steps.map((s) => {
          const n = funnel[s.key];
          return (
            <div key={s.key} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-sm">
              <span className="font-bold">
                {s.label}
                {s.note && <span className="block text-[11px] font-normal text-ink/45">{s.note}</span>}
              </span>
              <div className="h-3 overflow-hidden rounded-full border-2 border-ink bg-paper-dark">
                <div className="h-full bg-teal" style={{ width: `${Math.round((n / top) * 100)}%` }} />
              </div>
              <span className="text-right font-mono font-bold tabular-nums">{fmtNum(n)}</span>
            </div>
          );
        })}
      </div>
    </AdminCard>
  );
}

function Chip({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border-2 border-ink px-1.5 py-px text-[11px] font-bold ${
        tone === "warn" ? "bg-gold/30" : "bg-card"
      }`}
    >
      {children}
    </span>
  );
}

function didChips(r: PlayerGroup, testnet: boolean) {
  const out: { k: string; label: string; warn?: boolean }[] = [];
  if (testnet && r.faucet) out.push({ k: "faucet", label: `faucet ×${r.faucet}` });
  if (r.dailies) out.push({ k: "dailies", label: `daily ×${r.dailies}` });
  if (r.packs) out.push({ k: "packs", label: `pack ×${r.packs}` });
  if (r.waiting) out.push({ k: "waiting", label: `${r.waiting} unopened`, warn: true });
  if (r.claims) out.push({ k: "claims", label: `claimed ×${r.claims}` });
  if (r.rolls) out.push({ k: "rolls", label: `rolled ×${r.rolls} (${r.rollWins} up)` });
  if (r.stakes) out.push({ k: "stakes", label: `staked ×${r.stakes}` });
  if (r.feeds) out.push({ k: "feeds", label: `fed ×${r.feeds}` });
  if (r.listings) out.push({ k: "listings", label: `listed ×${r.listings}` });
  return out;
}

function PlayerTable({ rows, now, testnet }: { rows: PlayerGroup[]; now: number; testnet: boolean }) {
  if (rows.length === 0) {
    return (
      <AdminCard>
        <p className="text-sm text-ink/60">No players yet.</p>
      </AdminCard>
    );
  }
  return (
    <div className="cel overflow-x-auto rounded-2xl bg-paper">
      <table className="w-full min-w-[860px] text-left text-xs">
        <thead className="border-b-2 border-ink text-[11px] text-ink/55">
          <tr>
            <th className="px-3 py-2 font-bold">Player</th>
            <th className="px-3 py-2 font-bold">First seen</th>
            <th className="px-3 py-2 font-bold">Last seen</th>
            <th className="px-3 py-2 font-bold">Did</th>
            <th className="px-3 py-2 font-bold">Holds now</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const chips = didChips(r, testnet);
            return (
              <tr key={r.address} className={`border-b border-ink/10 align-top ${r.operator ? "bg-paper-dark/40" : ""}`}>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {r.pfpUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.pfpUrl} alt="" className="h-6 w-6 rounded-full border-2 border-ink object-cover" />
                    ) : (
                      <span className="h-6 w-6 rounded-full border-2 border-ink bg-paper-dark" />
                    )}
                    <div className="min-w-0">
                      <div className="font-bold">{r.name ? `@${r.name}` : shortAddr(r.address)}</div>
                      {/* Every wallet of the player, the account first: one row per player (linked wallets are one). */}
                      {r.wallets.map((w) => (
                        <a
                          key={w.address}
                          href={basescanAddress(w.address)}
                          target="_blank"
                          rel="noreferrer"
                          title={w.lastSeen ? `last seen ${whenUtc(w.lastSeen)}` : undefined}
                          className="block font-mono text-[11px] text-ink/50 underline"
                        >
                          {shortAddr(w.address)}
                        </a>
                      ))}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.operator && <StatusBadge tone="accent">team</StatusBadge>}
                    {r.wallets.length > 1 && <Chip>{r.wallets.length} wallets</Chip>}
                    {r.fids.map((f) => (
                      <Chip key={f}>fid {f}</Chip>
                    ))}
                  </div>
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {whenUtc(r.firstSeen)}
                  {r.sighting && <div className="text-[11px] text-ink/45">via {r.sighting.firstVia}</div>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {ago(r.lastSeen, now)}
                  {r.sighting && (
                    <div className="text-[11px] text-ink/45">
                      {/* Days are counted per wallet: with two wallets seen, the busiest one's days are a floor. */}
                      {r.sighting.days}
                      {r.seenWallets > 1 ? "+" : ""} day{r.sighting.days === 1 && r.seenWallets < 2 ? "" : "s"} · last via {r.sighting.lastVia}
                    </div>
                  )}
                </td>
                <td className="px-3 py-2">
                  {chips.length ? (
                    <div className="flex flex-wrap gap-1">
                      {chips.map((c) => (
                        <Chip key={c.k} tone={c.warn ? "warn" : "plain"}>
                          {c.label}
                        </Chip>
                      ))}
                    </div>
                  ) : (
                    <span className="text-ink/45">{r.sighting ? "connected, nothing onchain yet" : "–"}</span>
                  )}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  {r.holds.letters + r.holds.words === 0 ? (
                    <span className="text-ink/45">–</span>
                  ) : (
                    <>
                      <div>
                        {r.holds.letters} letter{r.holds.letters === 1 ? "" : "s"}
                        {r.holds.upper ? ` (${r.holds.upper} UPPER)` : ""}
                      </div>
                      <div className="text-[11px] text-ink/55">
                        {r.holds.words} word{r.holds.words === 1 ? "" : "s"}
                        {r.holds.staked ? ` · ${r.holds.staked} staked` : ""}
                      </div>
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
