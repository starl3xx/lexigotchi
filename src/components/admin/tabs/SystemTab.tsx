"use client";
/**
 * System — what THIS deployment is running, read live on the server (lib/admin/systemStatus.ts):
 * which game, every server key with its gas and whether the contracts point at it, whether the daily
 * keeper is keeping up, every feature switch with the settings it still needs, and which database
 * migrations are applied. Gated on the server (useAdminApi). Setting names only, never values.
 */
import type { KeyStatus, SystemPayload } from "@/lib/admin/systemStatus";
import { basescanAddress, shortAddr } from "@/lib/admin/format";
import { useAdminApi } from "../useAdminApi";
import { GatedState } from "../GatedState";
import { AdminCard, Banner, ErrorState, KeyVal, RefreshButton, SectionLabel, Spinner, StatusBadge } from "../ui";
import { Database, GearSix, Key, Warning, Wrench } from "../icons";
import { whenUtc } from "./PlayersTab";

/** Below this much ETH, a key that sends transactions is about to stop. */
const LOW_GAS_ETH = 0.002;

const ROLE_LABEL: Record<KeyStatus["role"], string> = {
  signer: "Signer",
  relayer: "Relayer (rolls, ascension, packs)",
  keeper: "Keeper",
  priceKeeper: "Price keeper",
};

export function SystemTab() {
  const api = useAdminApi<SystemPayload>("/api/admin/system");
  const data = api.data;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GearSix weight="bold" size={18} />
          <h2 className="font-display text-lg font-extrabold">System</h2>
          {data && <span className="text-xs text-ink/50">as of {whenUtc(new Date(data.at).toISOString())}</span>}
        </div>
        <RefreshButton onClick={() => api.reload(true)} loading={api.loading} />
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
          <GameCard data={data} />
          <KeysCard data={data} />
          <KeeperCard data={data} />
          <SwitchesCard data={data} />
          <DatabaseCard data={data} />
        </>
      ) : null}
    </div>
  );
}

function GameCard({ data }: { data: SystemPayload }) {
  const g = data.game;
  return (
    <AdminCard title="Which game runs">
      <KeyVal
        k="Network"
        v={
          <span>
            {data.network.name} · {data.network.id} {data.network.isTestnet && <StatusBadge tone="warning">testnet</StatusBadge>}
          </span>
        }
      />
      <KeyVal
        k="Game"
        v={
          g.chainBacked ? (
            <StatusBadge tone="ok">chain game: real contracts</StatusBadge>
          ) : (
            <StatusBadge tone="warning">practice game: nothing onchain</StatusBadge>
          )
        }
      />
      <KeyVal k="Real $WORD at stake" v={g.realEconomy ? "yes (mainnet)" : "no"} />
      {g.brake && (
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          NEXT_PUBLIC_CHAIN_GAME=0 is set: the emergency brake holds the practice game even though contracts exist.
        </Banner>
      )}
      {!g.suiteDeployed && !g.brake && (
        <p className="mt-2 text-xs text-ink/55">This network&apos;s registry has no full suite, so the practice game runs.</p>
      )}
    </AdminCard>
  );
}

function KeysCard({ data }: { data: SystemPayload }) {
  return (
    <section className="space-y-2">
      <SectionLabel>Server keys · public addresses only</SectionLabel>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {data.keys.map((k) => {
          const low = k.sends && k.balanceEth != null && k.balanceEth < LOW_GAS_ETH;
          const tone = !k.configured ? "warning" : k.error || k.wired === false || low ? "error" : "ok";
          return (
            <div key={k.role} className="cel rounded-2xl bg-paper p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-display text-sm font-extrabold">
                  <Key weight="bold" size={14} /> {ROLE_LABEL[k.role]}
                </span>
                <StatusBadge tone={tone}>
                  {!k.configured ? "not set" : k.error ? "malformed key" : k.wired === false ? "not wired" : low ? "low gas" : "ready"}
                </StatusBadge>
              </div>
              <p className="mt-1 text-[11px] leading-snug text-ink/55">{k.job}</p>
              <div className="mt-2 space-y-0.5 text-xs">
                <div>
                  <span className="text-ink/50">setting </span>
                  <code>{k.env}</code>
                </div>
                {k.address && (
                  <div>
                    <span className="text-ink/50">signs as </span>
                    <a className="font-mono underline" href={basescanAddress(k.address)} target="_blank" rel="noreferrer">
                      {shortAddr(k.address)}
                    </a>
                  </div>
                )}
                {k.sends && k.balanceEth != null && (
                  <div>
                    <span className="text-ink/50">gas </span>
                    <span className={low ? "font-bold text-candy" : ""}>{k.balanceEth.toFixed(5)} ETH</span>
                  </div>
                )}
                {k.onchain && (
                  <div>
                    <span className="text-ink/50">contracts expect </span>
                    <span className="font-mono">{shortAddr(k.onchain)}</span>
                    {k.wired === false && <span className="font-bold text-candy"> (a different key)</span>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function KeeperCard({ data }: { data: SystemPayload }) {
  const k = data.keeper;
  // Jackpot.lastResolvedDay is the UTC day of the last resolve, and a resolve can only happen for
  // the current day (Jackpot.sol: day = block.timestamp / 1 days). So "up to date" is lastResolvedDay
  // == today; 0 means it has never resolved.
  const never = k.jackpotResolvedDay === 0;
  const behind = k.chainDay != null && k.jackpotResolvedDay != null && !never ? k.chainDay - k.jackpotResolvedDay : null;
  return (
    <AdminCard title={<span className="inline-flex items-center gap-1.5"><Wrench weight="bold" size={14} /> Daily keeper</span>}>
      <p className="mb-2 text-xs text-ink/60">
        Runs by itself at 00:05 UTC (<code>/api/cron/keeper</code>), one job at a time, from the keeper key.
      </p>
      <KeyVal k="Jobs (KEEPER_JOBS)" v={k.jobsError ? <span className="text-candy">{k.jobsError}</span> : k.jobs?.join(", ") ?? "–"} />
      <KeyVal k="Answer schedule" v={k.answerSeed ? `seed set · ${k.answerDays ?? "?"} days` : <span className="text-candy">ANSWER_CHAIN_SEED not set</span>} />
      <KeyVal k="Chain day today" v={k.chainDay ?? "–"} mono />
      <KeyVal
        k="Jackpot last resolved"
        v={
          k.jackpotResolvedDay == null ? (
            "–"
          ) : never ? (
            <StatusBadge tone="warning">never</StatusBadge>
          ) : (
            <span>
              day {k.jackpotResolvedDay}{" "}
              {behind === 0 ? (
                <StatusBadge tone="ok">today</StatusBadge>
              ) : behind != null ? (
                <StatusBadge tone={behind === 1 ? "warning" : "error"}>
                  {behind} day{behind === 1 ? "" : "s"} ago
                </StatusBadge>
              ) : null}
            </span>
          )
        }
      />
      <KeyVal k="Answer chain reveals so far" v={k.answerReveals ?? "–"} mono />
      <p className="mt-2 text-[11px] text-ink/45">
        Each run resolves the day that is starting, so the jackpot reads &quot;today&quot; from 00:05 UTC on. &quot;1 day ago&quot; before
        then is normal; later than that, the run failed or has no key. The answer chain counts reveals, one per resolve.
      </p>
    </AdminCard>
  );
}

function SwitchesCard({ data }: { data: SystemPayload }) {
  return (
    <section className="space-y-2">
      <SectionLabel>Feature switches on this deployment</SectionLabel>
      <div className="cel divide-y divide-ink/10 rounded-2xl bg-paper">
        {data.switches.map((s) => (
          <div key={s.key} className="flex flex-wrap items-start justify-between gap-2 px-4 py-2.5">
            <div className="min-w-0 max-w-xl">
              <div className="text-sm font-bold">{s.label}</div>
              <div className="text-[11px] leading-snug text-ink/55">{s.detail}</div>
              {!s.on && s.missing.length > 0 && (
                <div className="mt-1 text-[11px] text-ink/70">
                  Needs: {s.missing.map((m) => <code key={m} className="mr-1.5">{m}</code>)}
                </div>
              )}
            </div>
            <StatusBadge tone={s.on ? "ok" : "warning"}>{s.on ? "on" : "off"}</StatusBadge>
          </div>
        ))}
      </div>
    </section>
  );
}

function DatabaseCard({ data }: { data: SystemPayload }) {
  const db = data.database;
  const owed = db.migrations.filter((m) => m.applied === false);
  return (
    <AdminCard title={<span className="inline-flex items-center gap-1.5"><Database weight="bold" size={14} /> Database</span>}>
      <KeyVal k="Connected" v={!db.configured ? "no DATABASE_URL" : db.reachable ? "yes" : <span className="text-candy">not reachable</span>} />
      {owed.length > 0 && (
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          {owed.length} migration{owed.length === 1 ? "" : "s"} owed: {owed.map((m) => m.tag).join(", ")}. Pull main, then{" "}
          <code>npm run db:migrate</code>. Until then those features stay dark.
        </Banner>
      )}
      <div className="mt-2 flex flex-wrap gap-1.5">
        {db.migrations.map((m) => (
          <StatusBadge key={m.tag} tone={m.applied ? "ok" : m.applied === false ? "warning" : "accent"}>
            {m.tag.replace(/^(\d{4})_/, "$1 ")}
          </StatusBadge>
        ))}
      </div>
      {db.reachable && <p className="mt-2 text-[11px] text-ink/45">Tables: {db.tables.join(", ")}</p>}
    </AdminCard>
  );
}
