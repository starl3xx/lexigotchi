/**
 * The kinds of reminder, and a player's choice of which to get (starl3xx, 2026-11-26: "A choice per
 * kind of reminder, stored with the profile. One switch for everything gets switched off").
 *
 * A choice is per PLAYER (their account: linked wallets are one player) and covers every way the
 * game reaches them: email, their browsers, Farcaster. Which channels are on is a separate matter,
 * and each has its own switch (the email box, "Turn on reminders", adding the mini app).
 *
 * Only what a player CHANGED is stored (lib/db/reminderPrefs.ts): everything else follows the
 * default here. So a player who changes nothing gets exactly what they got before choices existed,
 * and a kind added later starts at its own default for everyone.
 *
 * Pure: the profile sheet, the route, and every sender read this file.
 */
export const REMINDER_KINDS = ["hunger", "daily", "jackpot", "sold"] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export interface KindInfo {
  /** The checkbox's words, in the profile. */
  label: string;
  /** One line under it: when it comes. */
  hint: string;
  /** Whether a player gets it without choosing. A new kind that adds a daily message starts off. */
  on: boolean;
}

export const KIND_INFO: Record<ReminderKind, KindInfo> = {
  hunger: { label: "A word is about to go hungry", hint: "About a day before a staked word stops earning and sits out the jackpot.", on: true },
  daily: { label: "My free daily letter is ready", hint: "Once a day, only on a day you haven’t taken it.", on: true },
  jackpot: { label: "I won the jackpot", hint: "When your word is the day’s word.", on: true },
  sold: { label: "Something of mine sold", hint: "When a word or letters of yours sell on the Market.", on: true },
};

/** What a player changed from the defaults. */
export type KindChoices = Partial<Record<ReminderKind, boolean>>;

const isKind = (k: string): k is ReminderKind => (REMINDER_KINDS as readonly string[]).includes(k);

/** Does this player get this kind? Their choice, else the kind's default. */
export function wantsKind(choices: KindChoices | null | undefined, kind: ReminderKind): boolean {
  return choices?.[kind] ?? KIND_INFO[kind].on;
}

/** Every kind, on or off, for this player: what the profile shows. */
export function effectiveKinds(choices: KindChoices | null | undefined): Record<ReminderKind, boolean> {
  return Object.fromEntries(REMINDER_KINDS.map((k) => [k, wantsKind(choices, k)])) as Record<ReminderKind, boolean>;
}

/**
 * Choices from outside (a request body, a stored row): known kinds with true or false, nothing
 * else. Null when it isn't an object of those at all. A kind this build doesn't know is dropped,
 * not refused: a row written by a newer build must still read.
 */
export function parseChoices(raw: unknown): KindChoices | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: KindChoices = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!isKind(k)) continue;
    if (typeof v !== "boolean") return null;
    out[k] = v;
  }
  return out;
}

/** Only what differs from the defaults: what is worth storing. */
export function changedFromDefaults(choices: KindChoices): KindChoices {
  return Object.fromEntries(Object.entries(choices).filter(([k, v]) => isKind(k) && v !== KIND_INFO[k].on)) as KindChoices;
}
