"use client";
/**
 * Broadcast — operator announcement composer. Pulls live headline numbers, fills a cast from a
 * template, and opens the Warpcast composer (with the /play embed, so every announcement is a
 * launchable card). A growth/ops tool, self-contained (no game context).
 */
import { useState } from "react";
import type { PulsePayload } from "@/lib/admin/metrics";
import { SITE_URL } from "@/lib/site";
import { fmtPct, fmtUsd } from "@/lib/admin/format";
import { AdminCard, Banner, CopyButton, SectionLabel, useFetch } from "../ui";
import { Info, Megaphone, ShareNetwork } from "../icons";

const LIMIT = 320; // Farcaster cast character limit

export function BroadcastTab() {
  const { data } = useFetch<PulsePayload>("/api/admin/pulse");
  const h = data?.headline;
  const [text, setText] = useState("");

  const templates: { label: string; build: () => string }[] = [
    {
      label: "Daily jackpot",
      build: () =>
        `🏆 Today's Lexigotchi jackpot: ${h ? fmtUsd(h.jackpot) : "—"} in $WORD.\n\nStake a fed word that matches the day's secret answer to win the whole pot. Raise your letters, claim your word, check in daily. ↓`,
    },
    {
      label: "New bounty theme",
      build: () =>
        `🎯 This week's Lexigotchi bounty: words that contain a Q, Z or X.\n\nHold a staked, well-fed match and you share the bounty pool when the period ends. Go claim one. ↓`,
    },
    {
      label: "Collection milestone",
      build: () =>
        `📖 ${h ? fmtPct(h.dictionaryPct) : "—"} of the 4,438-word Lexigotchi dictionary is now claimed${h ? ` (${h.totalClaims.toLocaleString()} words)` : ""}.\n\nEvery word is a one-of-one. The rare ones are going fast — claim yours. ↓`,
    },
    {
      label: "General",
      build: () =>
        `Raise your letters. Spell your words. Own the dictionary.\n\nLexigotchi is a tamagotchi-style $WORD collection game on Base — mint letter characters, gamble them to UPPERCASE, claim words, stake for the daily jackpot. ↓`,
    },
  ];

  const over = text.length > LIMIT;
  const warpcast = () => {
    const u = new URL("https://warpcast.com/~/compose");
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
          Compose an operator announcement. Templates pull live numbers; the cast embeds <code>/play</code>, so it
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
              onClick={warpcast}
              disabled={!text.trim() || over}
              className="inline-flex items-center gap-1.5 rounded-xl border-[3px] border-ink bg-candy px-3 py-1.5 text-sm font-extrabold text-paper shadow-[3px_3px_0_#1b1714] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
            >
              <ShareNetwork weight="bold" size={14} /> Open in Warpcast
            </button>
          </div>
        </div>
      </AdminCard>
    </div>
  );
}
