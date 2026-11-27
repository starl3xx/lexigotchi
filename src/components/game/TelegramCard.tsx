"use client";
/**
 * "Telegram reminders": link a Telegram account to the profile, so the reminders the player keeps
 * on under "What to tell me" come as a message from the game's bot (lib/notify/telegram.ts).
 *
 * Linking takes two taps, on purpose:
 *   1. "Link Telegram" asks the server for a link that carries a single-use code (the profile's
 *      session makes it: `/api/profile/telegram`). It may need the wallet's sign-in first.
 *   2. "Open Telegram" opens that link. It is its own tap because a browser only lets a page open
 *      another app or tab from the tap itself, and step 1 has to wait for the server.
 * In Telegram the player presses Start, and the bot links whoever does (lib/telegramLink). The card
 * then asks the server every few seconds until the link shows, and stops when the link has
 * expired: "Link Telegram" comes back, for a fresh one.
 *
 * The card is rendered only where linking works (useProfile `telegramEnabled`).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Card } from "./primitives";
import { useOpenUrl } from "./useShare";

const SESSION_HEADER = "x-lexigotchi-session";
const ERRORS: Record<string, string> = {
  no_session: "Sign in with your wallet to link Telegram.",
  not_configured: "Telegram reminders aren’t switched on yet. Try again soon.",
  rate_limited: "Too many tries at once. Try again in a minute.",
};
const FAILED = "Couldn’t do that. Try again.";
const EXPIRED = "That link has expired. Tap Link Telegram for a new one.";
/** How long a link is taken to work when the server didn't say (it says: lib/db/telegramLinks). */
const LINK_LIFE_MS = 15 * 60_000;

/** How often the card asks whether the link has arrived, while the player is over in Telegram. */
const WAIT_POLL_MS = 3_000;

export interface TelegramCardProfile {
  address: string | null;
  sessionToken: string | null;
  ensureToken: () => Promise<string | null>;
}

interface Linked {
  name: string;
}

export function TelegramCard({ p }: { p: TelegramCardProfile }) {
  const qc = useQueryClient();
  const openUrl = useOpenUrl();
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The link to open, once the server has made one, and when it stops working: the player is on their way to Telegram. */
  const [link, setLink] = useState<{ url: string; expiresAt: number } | null>(null);
  // A link works for a quarter of an hour. Past that, the card stops asking and offers a fresh one.
  useEffect(() => {
    if (!link) return;
    const left = link.expiresAt - Date.now();
    const timer = setTimeout(() => {
      setLink(null);
      setNote(EXPIRED);
    }, Math.max(0, left));
    return () => clearTimeout(timer);
  }, [link]);
  const key = ["telegramLink", p.address, p.sessionToken];
  const q = useQuery({
    queryKey: key,
    enabled: Boolean(p.address && p.sessionToken),
    staleTime: 60_000,
    // While a link is out, ask until it lands.
    refetchInterval: (query) => (link && !query.state.data ? WAIT_POLL_MS : false),
    queryFn: async (): Promise<Linked | null> => {
      const r = await fetch("/api/profile/telegram", { headers: { [SESSION_HEADER]: p.sessionToken! } });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; linked?: Linked | null } | null;
      if (!d?.ok) throw new Error("telegram link unavailable");
      return d.linked ?? null;
    },
  });
  const linked = q.data ?? null;

  /** One call to the profile's Telegram route, with the session (asking for the sign-in if there is none). */
  const call = async (method: "POST" | "DELETE"): Promise<{ url?: string; expiresAt?: string; error?: string; token?: string }> => {
    const token = await p.ensureToken();
    if (!token) return { error: "no_session" };
    try {
      const r = await fetch("/api/profile/telegram", { method, headers: { [SESSION_HEADER]: token } });
      const d = (await r.json().catch(() => null)) as { ok?: boolean; error?: string; url?: string; expiresAt?: string } | null;
      return d?.ok ? { url: d.url, expiresAt: d.expiresAt, token } : { error: d?.error ?? "failed" };
    } catch {
      return { error: "failed" };
    }
  };

  const start = async () => {
    setNote(null);
    setBusy(true);
    const r = await call("POST");
    setBusy(false);
    const until = r.expiresAt ? Date.parse(r.expiresAt) : NaN;
    if (r.url) setLink({ url: r.url, expiresAt: Number.isFinite(until) ? until : Date.now() + LINK_LIFE_MS });
    else setNote(ERRORS[r.error ?? ""] ?? FAILED);
  };
  const unlink = async () => {
    setNote(null);
    setBusy(true);
    const r = await call("DELETE");
    setBusy(false);
    if (r.error) return void setNote(ERRORS[r.error] ?? FAILED);
    setLink(null);
    qc.setQueryData(["telegramLink", p.address, r.token], null);
  };

  return (
    <Card className="mb-3">
      <div className="font-display font-extrabold">Telegram reminders</div>
      <p className="mt-0.5 text-xs text-ink/60">The reminders you keep on under “What to tell me”, as a message from the Lexigotchi bot in Telegram.</p>

      {linked ? (
        <div className="mt-2 flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 truncate">
            Linked to <span className="font-bold">{linked.name}</span> on Telegram.
          </span>
          <button onClick={unlink} disabled={busy} className="shrink-0 text-xs font-bold text-ink/45 underline disabled:opacity-50">
            Unlink
          </button>
        </div>
      ) : link ? (
        <div className="mt-2 space-y-2">
          <p className="text-sm">Press Start in Telegram, then come back here.</p>
          {/* Its own tap: a browser opens another app or tab only from the tap itself. */}
          <Button size="sm" onClick={() => void openUrl(link.url)}>
            Open Telegram
          </Button>
          <p className="text-xs text-ink/55">The link works once, for 15 minutes.</p>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="mt-2" onClick={start} disabled={busy || !p.address}>
          {busy ? "One moment…" : "Link Telegram"}
        </Button>
      )}
      {note && <p className="mt-2 text-xs font-bold text-candy-ink">{note}</p>}
    </Card>
  );
}
