"use client";
/** Showcase — arrange any letters you own into any string and cast it. Off-chain, pure vanity. */
import { useState } from "react";
import { Button, Card, EmptyState, SectionTitle } from "../primitives";
import { LetterTile } from "../LetterTile";
import { TileCharacter } from "../TileCharacter";
import { Basket, ShareNetwork } from "../ui/icons";
import { idxToChar, useGame } from "../state";
import { useShare } from "../useShare";

interface Slot {
  idx: number;
  upper: boolean;
}

export function ShowcaseScreen() {
  const g = useGame();
  const { state } = g;
  const share = useShare();
  const [rack, setRack] = useState<Slot[]>([]); // start empty — the player arranges letters they own

  const showcaseText = rack.map((s) => (s.upper ? idxToChar(s.idx) : idxToChar(s.idx).toLowerCase())).join("");

  const used = (idx: number, upper: boolean) => rack.filter((s) => s.idx === idx && s.upper === upper).length;
  const tray = (upper: boolean) =>
    (upper ? state.upper : state.lower).map((c, i) => ({ i, c })).filter((x) => x.c > 0);

  // functional updater so batched taps can't exceed 8 slots or place more than you own
  const add = (idx: number, upper: boolean) =>
    setRack((prev) => {
      if (prev.length >= 8) return prev;
      const owned = (upper ? state.upper : state.lower)[idx];
      const usedInRack = prev.filter((s) => s.idx === idx && s.upper === upper).length;
      if (owned - usedInRack <= 0) return prev;
      return [...prev, { idx, upper }];
    });

  return (
    <div className="space-y-3">
      <div>
        <h1 className="font-display text-2xl font-extrabold">Showcase</h1>
        <p className="text-sm text-ink/60">Any letters, any order — no dictionary check. The flex that grows the game.</p>
      </div>

      {/* stage */}
      <Card className="bg-paper-dark/30">
        <div className="flex min-h-[120px] flex-wrap items-end justify-center gap-0.5 overflow-x-auto">
          {rack.length === 0 ? (
            <span className="self-center text-sm text-ink/45">tap letters below to build your showcase</span>
          ) : (
            rack.map((s, k) => (
              <button key={k} onClick={() => setRack((prev) => prev.filter((_, i) => i !== k))} title="remove" className="animate-pop">
                <TileCharacter char={idxToChar(s.idx)} upper={s.upper} detail="bust" size={Math.min(72, 360 / rack.length)} />
              </button>
            ))
          )}
        </div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-display text-sm font-extrabold tracking-wider">
            {rack.map((s) => (s.upper ? idxToChar(s.idx) : idxToChar(s.idx).toLowerCase())).join("")}
          </span>
          <button onClick={() => setRack([])} className="text-xs font-bold text-ink/45 underline">clear</button>
        </div>
      </Card>

      <Button
        full
        size="lg"
        variant="primary"
        disabled={rack.length < 2}
        onClick={() => share({ text: `${showcaseText} — my Lexigotchi showcase ✨` })}
      >
        <ShareNetwork weight="fill" /> Cast to Farcaster
      </Button>

      {/* trays */}
      <div>
        <SectionTitle>lowercase</SectionTitle>
        {tray(false).length === 0 ? (
          <EmptyState Icon={Basket} title="No lowercase letters" />
        ) : (
          <div className="grid grid-cols-6 gap-2.5">
            {tray(false).map(({ i, c }) => {
              const avail = c - used(i, false);
              return (
                <LetterTile key={i} char={idxToChar(i)} count={avail} dim={avail <= 0 || rack.length >= 8} onClick={avail > 0 ? () => add(i, false) : undefined} />
              );
            })}
          </div>
        )}
      </div>

      {tray(true).length > 0 && (
        <div>
          <SectionTitle>UPPERCASE</SectionTitle>
          <div className="grid grid-cols-6 gap-2.5">
            {tray(true).map(({ i, c }) => {
              const avail = c - used(i, true);
              return (
                <LetterTile key={i} char={idxToChar(i)} upper count={avail} dim={avail <= 0 || rack.length >= 8} onClick={avail > 0 ? () => add(i, true) : undefined} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
