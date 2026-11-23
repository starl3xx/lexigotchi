"use client";
/** More — the full "Do something" directory (the bottom-nav tab that used to dump into Claim). */
import { SectionTitle } from "../primitives";
import { useOpenUrl } from "../useShare";
import { DOCS_URL } from "@/lib/site";
import { QuickGrid } from "../QuickGrid";
import { ReminderToggle } from "../ReminderToggle";

export function MoreScreen() {
  const openUrl = useOpenUrl();
  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-extrabold">Do something</h1>
      <QuickGrid extended />
      <ReminderToggle />
      <SectionTitle>About</SectionTitle>
      <p className="text-xs text-ink/55">
        Raise your letters. Spell your words. Own the dictionary. A $WORD collection game on Base.
      </p>
      <button onClick={() => void openUrl(DOCS_URL)} className="mt-2 text-xs font-bold text-ink/60 underline">
        How to play: read the docs ↗
      </button>
    </div>
  );
}
