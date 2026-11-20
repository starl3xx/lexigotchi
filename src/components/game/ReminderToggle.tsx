"use client";
/**
 * The "remind me" control for browser push (useWebPush). Two sizes: the full card in More, and a
 * compact one-line button on Home's hunger card, where the reason to want it is on screen.
 * Renders nothing where reminders can't exist (not configured, inside a host, no wallet).
 */
import { useWebPush } from "./useWebPush";
import { Button } from "./primitives";
import { Bell, BellSlash, CircleNotch } from "./ui/icons";

export function ReminderToggle({ compact = false }: { compact?: boolean }) {
  const { state, error, enable, disable } = useWebPush();
  if (state === "unavailable" || state === "no-wallet") return null;

  if (compact) {
    // Only the one useful action belongs on Home: offer to turn reminders on. Everything else
    // (on, blocked, unsupported) lives in More, where there is room to explain it.
    if (state !== "off" && state !== "working") return null;
    return (
      <button
        onClick={enable}
        disabled={state === "working"}
        className="mt-2 flex items-center gap-1.5 text-xs font-bold text-ink/60 underline disabled:opacity-50"
      >
        {state === "working" ? <CircleNotch className="animate-spin" /> : <Bell weight="bold" />}
        {state === "working" ? "One moment…" : "Remind me before a word goes hungry"}
      </button>
    );
  }

  return (
    <div className="cel rounded-2xl bg-paper p-4">
      <div className="flex items-center gap-2 font-display font-extrabold">
        {state === "on" ? <Bell weight="fill" className="text-teal" /> : <BellSlash weight="bold" className="text-ink/50" />}
        Reminders {state === "on" ? "are on" : ""}
      </div>
      <p className="mt-1 text-xs leading-relaxed text-ink/60">
        A browser notification before a staked word goes hungry. You’ll also hear when your free daily
        letter is ready and if you win the jackpot.
      </p>

      {state === "needs-home-screen" && (
        <p className="mt-3 text-xs font-bold text-ink/70">
          On iPhone and iPad, add Lexigotchi to your Home Screen first: tap Share, then Add to Home Screen,
          and open it from there.
        </p>
      )}
      {state === "unsupported" && <p className="mt-3 text-xs font-bold text-ink/70">This browser can’t show notifications.</p>}
      {state === "denied" && (
        <p className="mt-3 text-xs font-bold text-ink/70">
          Notifications are blocked for this site. Allow them in your browser’s site settings, then come back.
        </p>
      )}
      {state === "off" && (
        <Button full variant="teal" className="mt-3" onClick={enable}>
          <Bell weight="bold" /> Turn on reminders
        </Button>
      )}
      {/* Neutral while a change is in flight: it may be turning on OR off. */}
      {state === "working" && (
        <Button full variant="ghost" className="mt-3" disabled>
          <CircleNotch className="animate-spin" /> One moment…
        </Button>
      )}
      {state === "on" && (
        <button onClick={disable} className="mt-3 text-xs font-bold text-ink/50 underline">
          Turn off
        </button>
      )}
      {error && <p className="mt-2 text-xs font-bold text-candy">{error}</p>}
    </div>
  );
}
