"use client";
/**
 * Broadcast — operator announcement composer. Pulls the LIVE game's numbers (/api/admin/live, never
 * the sim: an announcement must not quote a projected pot as a real one) and this week's bounty
 * theme (lib/themes.ts, the rotation the keeper pays on), fills a cast from a template, and opens
 * the Farcaster composer with the /play embed, so every announcement is a launchable card.
 *
 * The same text can go to the beta testers' Telegram group as the bot, and so can a poll
 * (TelegramBroadcast, gated on the server).
 */
import { useState } from "react";
import type { LivePayload } from "@/app/api/admin/live/route";
import { SITE_URL } from "@/lib/site";
import { THEMES, themeForPeriod } from "@/lib/themes";
import { DEFAULT_PARAMS } from "@/lib/params";
import { utcDay } from "@/lib/sightings";
import { fmtPct, fmtWordCompact } from "@/lib/admin/format";
import { AdminCard, Banner, CopyButton, SectionLabel, useFetch } from "../ui";
import { Info, Megaphone, ShareNetwork } from "../icons";
import { TelegramBroadcast } from "./TelegramBroadcast";

const LIMIT = 320; // Farcaster cast character limit

export function BroadcastTab() {
  const { data } = useFetch<LivePayload>("/api/admin/live");
  const live = data?.live ? data : null;
  const coin = live?.network?.isTestnet ? "test $WORD" : "$WORD";
  const theme = THEMES[themeForPeriod(Math.floor(utcDay() / DEFAULT_PARAMS.bounty.periodDays))];
  const [text, setText] = useState("");

  const templates: { label: string; build: () => string }[] = [
    {
      label: "Daily jackpot",
      build: () =>
        `🏆 Today's Lexigotchi jackpot: ${live?.buckets ? `${fmtWordCompact(live.buckets.jackpot)} ${coin}` : "–"}.\n\nHold the day's secret word, staked and awake, and the whole pot is yours. Raise your letters, claim your word, check in daily. ↓`,
    },
    {
      label: "New bounty theme",
      build: () =>
        `🎯 This week's Lexigotchi bounty theme: ${theme.name}.\n\nHold a match, staked and awake, and you share the bounty pool when the period ends. Go claim one. ↓`,
    },
    {
      label: "Collection milestone",
      build: () =>
        `📖 ${live?.words ? fmtPct(live.words.claimed / live.words.dictionary) : "–"} of the ${live?.words ? `${live.words.dictionary.toLocaleString("en-US")}-word ` : ""}Lexigotchi dictionary is now claimed${live?.words ? ` (${live.words.claimed.toLocaleString("en-US")} words)` : ""}.\n\nEvery word is a one-of-one. The rare ones are going fast — claim yours. ↓`,
    },
    {
      label: "General",
      build: () =>
        `Raise your letters. Spell your words. Own the dictionary.\n\nLexigotchi is a word-pet game on Base. Collect little letter characters, raise them to UPPERCASE, and spell words nobody else can own. Wake them every day, and they’re in the running for the daily jackpot. ↓`,
    },
  ];

  const over = text.length > LIMIT;
  const compose = () => {
    // The same composer the game's own shares use (useShare.ts).
    const u = new URL("https://farcaster.xyz/~/compose");
    u.searchParams.set("text", text);
    u.searchParams.append("embeds[]", `${SITE_URL}/play`);
    window.open(u.toString(), "_blank", "noopener,noreferrer");
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <Megaphone weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Broadcast</h2>
      </div>

      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        <span className="text-xs">
          Compose an operator announcement. Templates pull the live game&apos;s numbers
          {live?.network ? ` on ${live.network.name}` : ""} and this week&apos;s bounty theme; the cast embeds <code>/play</code>, so it
          renders as a launchable Lexigotchi card.
        </span>
      </Banner>

      <AdminCard title="Templates">
        <SectionLabel>fill the composer — then edit freely</SectionLabel>
        <div className="flex flex-wrap gap-2">
          {templates.map((t) => (
            <button
              key={t.label}
              onClick={() => setText(t.build())}
              className="rounded-lg border-2 border-ink bg-paper px-2.5 py-1 text-xs font-bold active:translate-y-[1px]"
            >
              {t.label}
            </button>
          ))}
        </div>
      </AdminCard>

      <AdminCard title="Composer">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          placeholder="Write an announcement, or pick a template above…"
          className="w-full resize-none rounded-xl border-[3px] border-ink bg-paper p-3 text-sm outline-none focus:bg-paper-dark/30"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className={`text-xs font-bold ${over ? "text-candy" : "text-ink/50"}`}>
            {text.length}/{LIMIT}
          </span>
          <div className="flex items-center gap-2">
            <CopyButton text={text} small label="Copy" />
            <button
              onClick={compose}
              disabled={!text.trim() || over}
              className="inline-flex items-center gap-1.5 rounded-xl border-[3px] border-ink bg-candy px-3 py-1.5 text-sm font-extrabold text-paper shadow-[3px_3px_0_#1b1714] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
            >
              <ShareNetwork weight="bold" size={14} /> Open in Farcaster
            </button>
          </div>
        </div>
      </AdminCard>

      <TelegramBroadcast text={text} />
    </div>
  );
}
