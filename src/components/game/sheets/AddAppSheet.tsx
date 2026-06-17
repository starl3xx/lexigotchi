"use client";
/**
 * AddAppSheet — the one-time "add Lexigotchi to your apps" nudge, shown the first time a player
 * mints (a free daily letter or a pack) from inside a Farcaster client. Opened by AddAppHost, which
 * also persists the "prompted" flag so it never nags twice. Adding lets Farcaster nudge the player
 * before they miss a daily or let a word go hungry.
 */
import { useState } from "react";
import { useGame } from "../state";
import { useAddMiniApp } from "../useAddMiniApp";
import { TileCharacter } from "../TileCharacter";
import { Sheet, Button } from "../primitives";
import { Check, CircleNotch, Plus } from "../ui/icons";

export function AddAppSheet() {
  const { closeSheet, toast } = useGame();
  const { add, adding, inFarcaster } = useAddMiniApp();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onAdd() {
    setErr(null);
    const { ok, error } = await add();
    if (ok) {
      setDone(true);
      toast("Added — see you tomorrow! 🎩", "good");
      window.setTimeout(closeSheet, 900);
    } else if (error) {
      setErr(error);
    }
  }

  return (
    <Sheet open onClose={closeSheet} title="Add Lexigotchi">
      <div className="flex flex-col items-center gap-4 pb-2 text-center">
        <TileCharacter char="W" detail="full" state={done ? "celebrate" : "idle"} size={104} />
        <div>
          <h3 className="font-display text-lg font-extrabold">Keep your letters close</h3>
          <p className="mx-auto mt-1 max-w-[22rem] text-sm leading-relaxed text-ink/70">
            Add Lexigotchi to your Farcaster apps so your free daily letter, the jackpot, and your hungry
            words are one tap away — and get a nudge before you miss a day.
          </p>
        </div>

        {err && <p className="text-xs font-bold text-candy">{err}</p>}

        <div className="flex w-full flex-col items-center gap-2">
          <Button full size="lg" variant="primary" onClick={onAdd} disabled={adding || done || !inFarcaster}>
            {done ? (
              <>
                <Check weight="bold" size={18} /> Added
              </>
            ) : adding ? (
              <>
                <CircleNotch weight="bold" size={18} className="animate-spin" /> Adding…
              </>
            ) : (
              <>
                <Plus weight="bold" size={18} /> Add Lexigotchi
              </>
            )}
          </Button>
          <button onClick={closeSheet} className="py-1 text-sm font-bold text-ink/45 active:translate-y-[1px]">
            Maybe later
          </button>
        </div>
      </div>
    </Sheet>
  );
}
