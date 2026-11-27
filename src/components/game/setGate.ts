/**
 * The first-day gate, in the player's words (decisions.md, "Reserved word sets"). For the first day
 * after a set is released, each player may claim one of its words (the set's own limit), and only a
 * verified player. `POST /api/sets/voucher` says which rule stopped a claim; this says it to the
 * player, with when the word opens to everyone. Pure.
 */

/** The server's refusal, as it arrives. */
export interface GateRefusal {
  error: string;
  /** The set's first-day rule (not_on_list): "allowlist" or "token"; and the operator's words for who it lets in. */
  rule?: string;
  label?: string | null;
  /** not_on_list: another wallet of the player's profile IS let in (the claim must come from that one). */
  linked?: boolean;
  /** The words that hold the player's slots (limit_reached). */
  words?: string[];
  limit?: number;
  /** When the gate lifts, in seconds. */
  until?: number;
}

/**
 * Who a first day with a rule of its own is open to, to end a sentence: the operator's own words
 * when the set has them, or the plain wording for its rule. (A plain first day is every verified
 * player, and the callers say that themselves.)
 */
export function firstDayWho(rule: string | undefined, label: string | null | undefined): string {
  const own = label?.trim();
  if (own) return own;
  return rule === "token" ? "holders of this set’s token" : "players on this set’s list";
}

/** How long until the gate lifts, in words. */
export function gateLeft(untilSec: number, nowSec: number): string {
  const s = Math.max(0, untilSec - nowSec);
  if (s < 90) return "a moment";
  if (s < 5400) return `about ${Math.round(s / 60)} minutes`;
  const h = Math.round(s / 3600);
  return `about ${h} ${h === 1 ? "hour" : "hours"}`;
}

export interface GateNote {
  text: string;
  tone: "info" | "bad";
  /** The fix is in the profile (link an account, or sign in): open it. */
  openProfile: boolean;
}

/**
 * What to tell a player whose claim of a gated `word` was refused. `untilSec` is the gate's end as
 * the game knows it, used when the refusal carries none.
 */
export function gateRefusalNote(word: string, r: GateRefusal, nowSec: number, untilSec: number): GateNote {
  const W = word.toUpperCase();
  const left = gateLeft(r.until ?? untilSec, nowSec);
  switch (r.error) {
    case "limit_reached": {
      const mine = r.words?.[0];
      const limit = r.limit ?? 1;
      return {
        text:
          limit <= 1
            ? `First day: one word per player from this set${mine ? `, and yours is ${mine}` : ""}. ${W} opens to everyone in ${left}.`
            : `First day: ${limit} words per player from this set, and you have yours. ${W} opens to everyone in ${left}.`,
        tone: "info",
        openProfile: false,
      };
    }
    case "verification_required":
    case "farcaster_wallet_unverified":
      return {
        text: `First day: link Farcaster, X, or a Coinbase-verified wallet to claim from a new set. ${W} opens to everyone in ${left}.`,
        tone: "info",
        openProfile: true,
      };
    case "x_too_young":
      return {
        text: `First day: your X account is too new to count yet. ${W} opens to everyone in ${left}.`,
        tone: "info",
        openProfile: false,
      };
    case "not_on_list":
      return {
        text: r.linked
          ? `First day: this set is open to ${firstDayWho(r.rule, r.label)}. Claim ${W} with the wallet of yours that qualifies.`
          : `First day: this set is open to ${firstDayWho(r.rule, r.label)}. ${W} opens to everyone in ${left}.`,
        tone: "info",
        openProfile: false,
      };
    case "sign_in":
      return {
        text: `First day: sign in to your profile to show this wallet is yours, then claim ${W} again.`,
        tone: "info",
        openProfile: true,
      };
    case "taken":
      return { text: `${W} was just claimed.`, tone: "bad", openProfile: false };
    default:
      return { text: `Couldn’t get ${W} ready just now. Try again in a moment.`, tone: "info", openProfile: false };
  }
}
