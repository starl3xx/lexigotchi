"use client";
/**
 * "What to tell me": the player's choice of reminders (lib/notify/kinds.ts), in their profile
 * (starl3xx, 2026-11-26: "A choice per kind of reminder, stored with the profile").
 *
 * One list for every way the game reaches them (email, their browser, Farcaster, Telegram): how
 * they are reached is switched elsewhere (the email box, "Turn on reminders", adding the mini app,
 * "Link Telegram"), and this says about what. A choice is the account's, so it needs the wallet's session to change: a tap
 * with none asks for the sign-in first, the same one the rest of the profile uses.
 *
 * Until the player's own choices load, the boxes show the defaults, which is what they get.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { Card } from "./primitives";
import { KIND_INFO, REMINDER_KINDS, effectiveKinds, type EmailCadence, type ReminderKind } from "@/lib/notify/kinds";
import { useSets } from "./useSets";

const SESSION_HEADER = "x-lexigotchi-session";
const ERRORS: Record<string, string> = {
  no_session: "Sign in with your wallet to change this.",
  not_configured: "Choices aren’t switched on yet. Try again soon.",
  rate_limited: "Too many changes at once. Try again in a minute.",
};

export interface ReminderChoicesProfile {
  address: string | null;
  sessionToken: string | null;
  ensureToken: () => Promise<string | null>;
}

interface Stored {
  kinds: Record<ReminderKind, boolean>;
  emailCadence: EmailCadence;
}

/**
 * `hasEmail`: the player has an email saved, so how often it comes is theirs to choose too.
 * `telegram`: reminders by Telegram are offered here, so the card names it among the ways.
 */
export function ReminderChoices({ p, hasEmail = false, telegram = false }: { p: ReminderChoicesProfile; hasEmail?: boolean; telegram?: boolean }) {
  const qc = useQueryClient();
  const key = ["reminderKinds", p.address, p.sessionToken];
  const [note, setNote] = useState<string | null>(null);
  const setsNow = useSets();
  const anySets = setsNow.known && setsNow.sets.length > 0;
  const [saving, setSaving] = useState<ReminderKind | "cadence" | null>(null);
  const cadenceLabel = useId();
  const q = useQuery({
    queryKey: key,
    enabled: Boolean(p.address && p.sessionToken),
    staleTime: 60_000,
    queryFn: async () => {
      const r = await fetch("/api/profile/reminders", { headers: { [SESSION_HEADER]: p.sessionToken! } });
      const d = (await r.json().catch(() => null)) as ({ ok?: boolean } & Partial<Stored>) | null;
      if (!d?.ok || !d.kinds) throw new Error("reminder choices unavailable");
      return { kinds: d.kinds, emailCadence: d.emailCadence ?? "each" } satisfies Stored;
    },
  });
  const kinds = q.data?.kinds ?? effectiveKinds(null);
  const cadence = q.data?.emailCadence ?? "each";

  /** One change, saved at once: a kind's box, or how often email comes. */
  const save = async (what: ReminderKind | "cadence", body: { kinds?: Partial<Record<ReminderKind, boolean>>; emailCadence?: EmailCadence }) => {
    setNote(null);
    const token = await p.ensureToken();
    if (!token) return void setNote(ERRORS.no_session);
    setSaving(what);
    try {
      const r = await fetch("/api/profile/reminders", {
        method: "PUT",
        headers: { "content-type": "application/json", [SESSION_HEADER]: token },
        body: JSON.stringify(body),
      });
      const d = (await r.json().catch(() => null)) as ({ ok?: boolean; error?: string } & Partial<Stored>) | null;
      if (d?.ok && d.kinds) qc.setQueryData(["reminderKinds", p.address, token], { kinds: d.kinds, emailCadence: d.emailCadence ?? "each" } satisfies Stored);
      else setNote(ERRORS[d?.error ?? ""] ?? "Couldn’t save that. Try again.");
    } catch {
      setNote("Couldn’t save that. Try again.");
    } finally {
      setSaving(null);
    }
  };

  // "A new set of words" is offered once the game has a set to speak of (decisions.md, "Reserved
  // word sets"): before the first set exists there is nothing it could tell anyone.
  const shownKinds = REMINDER_KINDS.filter((kind) => kind !== "sets" || anySets);

  return (
    <Card className="mb-3">
      <div className="font-display font-extrabold">What to tell me</div>
      <p className="mt-0.5 text-xs text-ink/70">
        Your choice for every way we reach you: email, your browser, {telegram ? "Farcaster, and Telegram" : "and Farcaster"}.
      </p>
      <ul className="mt-2 space-y-2">
        {shownKinds.map((kind) => (
          <li key={kind}>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={kinds[kind]}
                disabled={saving !== null}
                onChange={(e) => void save(kind, { kinds: { [kind]: e.target.checked } })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#2a9d8f]"
              />
              <span className="min-w-0">
                <span className="block font-medium leading-tight">{KIND_INFO[kind].label}</span>
                <span className="block text-xs text-ink/70">{KIND_INFO[kind].hint}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {hasEmail && (
        // A labelled group, not a fieldset: a floated legend pushed the first choice out of the card.
        <div role="radiogroup" aria-labelledby={cadenceLabel} className="mt-3 space-y-2 border-t-2 border-dashed border-ink/15 pt-3">
          <div id={cadenceLabel} className="font-display font-extrabold">
            How often by email
          </div>
          {(
            [
              ["each", "Each one as it happens", null],
              ["weekly", "One email a week", "In place of the ones that can come every day. A word about to fall asleep, a win, a sale, and a bounty share still come at once."],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className="flex items-start gap-2 text-sm">
              <input
                type="radio"
                name="email-cadence"
                checked={cadence === value}
                disabled={saving !== null}
                onChange={() => void save("cadence", { emailCadence: value })}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[#2a9d8f]"
              />
              <span className="min-w-0">
                <span className="block font-medium leading-tight">{label}</span>
                {hint && <span className="block text-xs text-ink/70">{hint}</span>}
              </span>
            </label>
          ))}
        </div>
      )}
      {q.isError && <p className="mt-2 text-xs text-ink/70">Couldn’t load your choices. These are the usual ones.</p>}
      {note && (
        <p role="alert" className="mt-2 text-xs font-medium text-candy-ink">
          {note}
        </p>
      )}
    </Card>
  );
}
