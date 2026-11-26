// @vitest-environment jsdom
/**
 * Share on the Earnings sheet (components/game/sheets/EarningsSheet.tsx; starl3xx, 2026-11-25: "this
 * 'Your earnings' thing should be sharable in the same way words are... share to X, FC, download
 * image"). It shows only with the server's signed snapshot (never in practice, whose numbers are
 * invented), and what it posts is the token's amount, never this screen's own sums.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { encodeSnapshot, earningsCardV } from "@/lib/earningsShare";
import { SITE_URL } from "@/lib/site";

// The post names the token "$WORD" on Base and "test $WORD" on a test network: Base here, whatever the shell says.
vi.hoisted(() => {
  process.env.NEXT_PUBLIC_CHAIN_ID = "8453";
});

window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

const DAY = Math.floor(Date.UTC(2026, 10, 26) / 86_400_000);
/** What the server signed: less than the screen's fresher total below, on purpose. */
const TOKEN = `${encodeSnapshot({ chainId: 8453, latestDay: DAY, total: 2_400_000, latest: 180_500, words: [["CRANE", 96_300], ["TEASE", 84_200]] })}.signature-is-the-servers`;

const posted = vi.hoisted(() => ({ x: [] as { text: string; url: string }[], cast: [] as { text: string; embed?: string }[], saved: [] as string[], src: [] as (string | null)[] }));
vi.mock("@/components/game/useShare", () => ({
  usePostToX: () => (p: { text: string; url: string }) => void posted.x.push(p),
  useShare: () => (p: { text: string; embed?: string }) => void posted.cast.push(p),
  useSaveImage: (src: string | null, name: string) => {
    posted.src.push(src);
    return async () => void posted.saved.push(name);
  },
}));
vi.mock("@/components/scenes/useWordScene", () => ({ useWordScene: () => ({ scene: "spring" }) }));

const word = (w: string, upper: boolean) => ({ word: w, tier: "Common", upper: Array(5).fill(upper), staked: true, daysUnfed: 0, prestigeLevel: 0, prestigePity: 0, mine: true });
let game: Record<string, unknown>;
vi.mock("@/components/game/state", async (orig) => {
  const real = await orig<typeof import("@/components/game/state")>();
  return { ...real, showsUsd: () => false, useGame: () => game };
});

const { EarningsSheet } = await import("@/components/game/sheets/EarningsSheet");

beforeEach(() => {
  posted.x.length = posted.cast.length = posted.saved.length = posted.src.length = 0;
  game = {
    state: { chainBacked: true, words: [word("TEASE", true), word("CRANE", true), word("PIXEL", false)] },
    earnings: {
      latestAt: DAY * 86_400_000 + 300_000,
      total: 2_650_000, latest: 180_500, waiting: 0, bounty: 0,
      byWord: { CRANE: { total: 96_300, latest: 96_300, waiting: 0 }, TEASE: { total: 84_200, latest: 84_200, waiting: 0 } },
    },
    earningsShare: TOKEN,
    claimables: [],
    closeSheet() {},
    openSheet() {},
    claimEarnings() {},
  };
});
afterEach(cleanup);

const tz = -new Date().getTimezoneOffset();
const look = `w=CRANE&scene=spring${tz ? `&tz=${tz}` : ""}`;

describe("Share on the Earnings sheet", () => {
  it("offers X, a cast, and the picture, with the top word’s card beside the tag", () => {
    render(<EarningsSheet />);
    expect(screen.queryByRole("button", { name: /Post my earnings on X/ })).toBeNull(); // not until asked
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    // the picture that travels alone: 16:9, the wordmark, the list's first word (the top earner) in its scene
    const picture = `/e/${TOKEN}/card?${look}&ratio=16x9&saved=1&v=${earningsCardV()}`;
    expect(screen.getByRole("img", { name: /CRANE’s card/ }).getAttribute("src")).toBe(picture);
    expect(posted.src.at(-1)).toBe(picture);

    fireEvent.click(screen.getByRole("button", { name: /Post my earnings on X/ }));
    fireEvent.click(screen.getByRole("button", { name: /Cast/ }));
    fireEvent.click(screen.getByRole("button", { name: /Save image/ }));
    const url = `${SITE_URL}/e/${TOKEN}?${look}`;
    // the TOKEN's amount (2.40M), not the screen's fresher 2.65M: the words match the picture
    expect(posted.x).toEqual([{ text: "CRANE and my other words have earned 2.40M $WORD in @lexigotchi ✨", url }]);
    expect(posted.cast).toEqual([{ text: "CRANE and my other words have earned 2.40M $WORD in Lexigotchi ✨", embed: url }]);
    expect(posted.saved).toEqual(["lexigotchi-earnings.png"]);
  });

  it("has no Share without the server’s snapshot: practice, nothing earned, or sharing not configured", () => {
    game.earningsShare = null;
    render(<EarningsSheet />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("has no Share with no word whose card could lie beside the tag", () => {
    game.state = { chainBacked: true, words: [] };
    render(<EarningsSheet />);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("shows nothing for a token it can’t read", () => {
    game.earningsShare = "garbage";
    render(<EarningsSheet />);
    fireEvent.click(screen.getByRole("button", { name: "Share" }));
    expect(screen.queryByRole("button", { name: /Post my earnings on X/ })).toBeNull();
  });
});
