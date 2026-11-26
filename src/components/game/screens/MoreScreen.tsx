"use client";
/** More — the full "Do something" directory (the bottom-nav tab that used to dump into Claim). */
import { Button, SectionTitle } from "../primitives";
import { EnvelopeSimple, ShoppingBag } from "../ui/icons";
import { shopEnabled } from "@/lib/shop/config";
import { useGame } from "../state";
import { usePublicProfile } from "../useProfile";
import { useOpenUrl } from "../useShare";
import { DOCS_URL, X_HANDLE, X_URL } from "@/lib/site";
import { QuickGrid } from "../QuickGrid";
import { ReminderToggle } from "../ReminderToggle";

export function MoreScreen() {
  const openUrl = useOpenUrl();
  const { openSheet, state } = useGame();
  const { emailEnabled } = usePublicProfile();
  return (
    <div className="space-y-3">
      <h1 className="font-display text-2xl font-extrabold">Do something</h1>
      <QuickGrid extended />
      {/* The Shop (decisions.md #22): a sheet, and no entry while SHOP_ENABLED is off. */}
      {state.chainBacked && shopEnabled() && (
        <button onClick={() => openSheet({ kind: "shop" })} className="cel-sm flex w-full items-center gap-3 rounded-2xl bg-card p-3 text-left press">
          <ShoppingBag size={26} weight="bold" className="press-icon text-candy-ink" />
          <span>
            <span className="block font-display text-sm font-extrabold">Shop</span>
            <span className="block text-xs text-ink/60">Things for your words, in USDC</span>
          </span>
        </button>
      )}
      <ReminderToggle />
      {/* Email reminders live in the profile; this makes them findable where the other reminders are. */}
      {emailEnabled && (
        <div className="cel rounded-2xl bg-card p-4">
          <div className="flex items-center gap-2 font-display font-extrabold">
            <EnvelopeSimple weight="bold" /> Email reminders
          </div>
          <p className="mt-1 text-xs leading-relaxed text-ink/60">
            Before a word goes hungry, when your daily letter is ready, when something of yours sells, and when your
            words win the jackpot or a share of the bounty. Your email is never shown to anyone.
          </p>
          <Button size="sm" variant="ghost" className="mt-3" onClick={() => openSheet({ kind: "profile" })}>
            Set up in your profile
          </Button>
        </div>
      )}
      <SectionTitle>About</SectionTitle>
      <p className="text-xs text-ink/55">
        Raise your letters. Spell your words. Own the dictionary. A word-pet game on Base.
      </p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
        <button onClick={() => void openUrl(DOCS_URL)} className="text-xs font-bold text-ink/60 underline">
          How to play: read the docs ↗
        </button>
        <button onClick={() => void openUrl(X_URL)} className="text-xs font-bold text-ink/60 underline">
          Follow @{X_HANDLE} on X ↗
        </button>
      </div>
    </div>
  );
}
