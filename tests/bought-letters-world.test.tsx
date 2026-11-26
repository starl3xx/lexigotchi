// @vitest-environment jsdom
/**
 * The bought-letters sheet in the CHAIN game (sheets/BoughtLettersSheet.tsx), where a word someone
 * else owns can't be claimed, and who owns what comes from the world read. While that read loads,
 * the sheet says it is checking and names nothing; if it failed, the sheet does what Spell does
 * (only the player's own words are taken), so the claim is never hidden for good (Bugbot on #223).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;

let world: { data?: { owners: Record<string, string> }; isPending: boolean };
vi.mock("@/components/game/useWorld", () => ({ useWorld: () => world }));

const bag = (letters: string) => {
  const n = new Array<number>(26).fill(0);
  for (const ch of letters) n[ch.toUpperCase().charCodeAt(0) - 65]++;
  return n;
};
vi.mock("@/components/game/state", async (orig) => {
  const real = await orig<typeof import("@/components/game/state")>();
  return {
    ...real,
    showsUsd: () => false,
    useGame: () => ({
      // "unbo" held, and the x that was just bought
      state: { chainBacked: true, lower: bag("unbox"), upper: bag(""), words: [] },
      price: () => 2_000_000,
      canAfford: () => true,
      closeSheet() {},
      openSheet() {},
      nav() {},
      claim() {},
    }),
  };
});

const { BoughtLettersSheet } = await import("@/components/game/sheets/BoughtLettersSheet");
const X = "X".charCodeAt(0) - 65;
const show = () => render(<BoughtLettersSheet letterId={X} count={1} unitPrice={9_800_000} had={0} />);

afterEach(cleanup);

describe("the bought-letters sheet, in the chain game", () => {
  it("says it is checking while the world’s owners load, and names no word yet", () => {
    world = { data: undefined, isPending: true };
    show();
    expect(screen.getByText("Checking what you can spell now…")).toBeTruthy();
    expect(screen.queryByText("Now you can spell")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Claim / })).toBeNull();
  });

  it("offers the claim once the owners are known", () => {
    world = { data: { owners: {} }, isPending: false };
    show();
    expect(screen.getByRole("button", { name: /^Claim UNBOX ·/ })).toBeTruthy();
  });

  it("never offers a word another player owns", () => {
    world = { data: { owners: { UNBOX: "0x0000000000000000000000000000000000000001" } }, isPending: false };
    show();
    expect(screen.queryByRole("button", { name: /^Claim / })).toBeNull();
    expect(screen.getByText("It’s in your bag, ready to spell with.")).toBeTruthy();
  });

  it("still offers the claim when the world read failed, as Spell does", () => {
    world = { data: undefined, isPending: false };
    show();
    expect(screen.getByRole("button", { name: /^Claim UNBOX ·/ })).toBeTruthy();
  });
});
