/**
 * Links INTO the game: `/play?go=<key>` opens one screen at one of its parts (decisions.md, "A
 * set's moments in the game"). A notice names its place with one of these, so a tap lands on what
 * the notice is about, never on Today with the player left to find it.
 *
 * Only the keys below mean anything. The game reads `go` once, removes it from the address, and
 * ignores a value it doesn't know (a link is the outside world's text, and the part's name ends in
 * a selector).
 *
 * Pure: the notice templates (server) and the game (client) both read this file.
 */
import { SITE_URL } from "./site";

/** key → the screen and the part of it. The names are the game's own (components/game/state.tsx View, ViewSection). */
export const GO = {
  /** The Dictionary's Sets section. */
  sets: { view: "dictionary", section: "sets" },
} as const;

export type GoKey = keyof typeof GO;

/** Where a `go` value leads, or null for anything that isn't a known key. */
export function goTarget(raw: string | null | undefined): (typeof GO)[GoKey] | null {
  return typeof raw === "string" && Object.prototype.hasOwnProperty.call(GO, raw) ? GO[raw as GoKey] : null;
}

/** The address a notice carries for `key`. */
export function goUrl(key: GoKey, site: string = SITE_URL): string {
  return `${site}/play?go=${key}`;
}

/**
 * A notice's link, for a channel that takes any address (email): the link itself when it is one of
 * the game's own pages, and the game's front door for anything else.
 */
export function ownLink(url: string | undefined, site: string = SITE_URL): string {
  const home = `${site}/play`;
  if (!url) return home;
  try {
    return new URL(url).origin === new URL(site).origin ? url : home;
  } catch {
    return home;
  }
}
