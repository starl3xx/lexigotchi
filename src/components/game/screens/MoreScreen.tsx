"use client";
/** More — the full "Do something" directory (the bottom-nav tab that used to dump into Claim). */
import { SectionTitle } from "../primitives";
import { QuickGrid } from "../QuickGrid";

export function MoreScreen() {
  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-extrabold">Do something</h1>
      <QuickGrid extended />
      <SectionTitle>About</SectionTitle>
      <p className="text-xs text-ink/55">
        Raise your letters. Spell your words. Own the dictionary. — a $WORD collection game on Base.
      </p>
    </div>
  );
}
