/**
 * Each reminder kind in a few words, for the operator console's chips (the Players tab's "Reminders
 * and accounts"). Its own file, with nothing but the kinds' type: the tab imports it into the
 * browser, and lib/admin/playerReach.ts, which builds the rows, reaches the senders' code.
 * Typed by every kind, so a new kind can't be missed.
 */
import type { ReminderKind } from "@/lib/notify/kinds";

export const KIND_SHORT: Record<ReminderKind, string> = {
  hunger: "hungry word",
  daily: "daily letter",
  jackpot: "jackpot win",
  sold: "sales",
  bounty: "bounty share",
  payday: "payday",
  deal: "letter deals",
  sets: "new sets",
};
