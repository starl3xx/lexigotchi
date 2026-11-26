// @vitest-environment jsdom
/**
 * The holder's picture, stamped on the back of their cards (decisions.md #48, part 6): one ink, an
 * engraved ring, beside the number; the player's own picture only, and theirs to turn off.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { LEDGER_LEFT, STAMP_FACE, inkRgb, oneInk, stampBox, stampRingSvg } from "@/components/cards/stamp";

const me = vi.hoisted(() => ({ pfpUrl: "https://pics.example/me.png" as string | null }));
vi.mock("@/components/game/useViewer", () => ({ useViewer: () => ({ isAuthed: true, username: "marlowe", pfpUrl: me.pfpUrl, environment: "web" }) }));
vi.mock("@/components/game/useProfile", () => ({
  useProfile: () => ({ profile: null }),
  resolveIdentity: (viewer: { username: string; pfpUrl: string | null }) => ({ name: `@${viewer.username}`, pfpUrl: viewer.pfpUrl, source: "farcaster" }),
}));

const { CardStamp, CardStampChoice, useMyStamp } = await import("@/components/cards/CardStamp");
const { setCardStamp, useCardStampChoice } = await import("@/components/cards/useCardStamp");

beforeEach(() => {
  window.localStorage.clear();
  act(() => setCardStamp(true));
  me.pfpUrl = "https://pics.example/me.png";
});

describe("the stamp's shapes", () => {
  it("on the back's picture, sits beside the number and left of the ledger; with no number, in the top left corner", () => {
    const beside = stampBox(true);
    expect(beside.cx + beside.size / 2).toBeLessThan(LEDGER_LEFT);
    expect(beside.cx - beside.size / 2).toBeGreaterThan(0.33); // right of the number's digits
    const corner = stampBox(false);
    expect(corner.cx - corner.size / 2).toBeGreaterThan(0.05);
    expect(corner.cy - corner.size / 2).toBeGreaterThan(0.02);
    expect(corner.size).toBeLessThan(beside.size);
    expect(STAMP_FACE).toBeLessThan(1);
  });

  it("turns a picture to one ink: black stays black, white becomes the ink, and nothing becomes see-through", () => {
    const ink = inkRgb("#e9b949");
    expect(ink).toEqual([233, 185, 73]);
    const px = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 200]);
    oneInk(px, ink);
    expect([...px.slice(0, 4)]).toEqual([0, 0, 0, 255]);
    expect([...px.slice(4, 8)]).toEqual([233, 185, 73, 255]);
    // a middle grey lands between the two, in the ink's own hue, and keeps its own alpha
    expect(px[8]).toBeGreaterThan(60);
    expect(px[8]).toBeLessThan(233);
    expect(px[8] / px[10]).toBeCloseTo(233 / 73, 0);
    expect(px[11]).toBe(200);
  });

  it("the ring is an engraving in the ink: lines only, no text, nothing fetched", () => {
    const svg = stampRingSvg("#7fb0ef");
    expect(svg).toContain('stroke="#7fb0ef"');
    expect(svg).not.toMatch(/<text|<image|href=|<script|fill="#/);
    expect(svg).not.toContain("NaN");
  });
});

describe("the player's choice", () => {
  it("is on until turned off, is kept on this device, and every reader on the page follows it at once", () => {
    const a = renderHook(() => useCardStampChoice());
    const b = renderHook(() => useCardStampChoice());
    expect(a.result.current[0]).toBe(true);
    act(() => a.result.current[1](false));
    expect(a.result.current[0]).toBe(false);
    expect(b.result.current[0]).toBe(false);
    expect(window.localStorage.getItem("lexigotchi.cardStamp")).toBe("off");
    act(() => b.result.current[1](true));
    expect(a.result.current[0]).toBe(true);
    expect(window.localStorage.getItem("lexigotchi.cardStamp")).toBeNull();
  });

  it("the profile's switch turns it off and on", () => {
    const { getByRole } = render(<CardStampChoice />);
    const box = getByRole("checkbox", { name: /Show my picture on my cards/ }) as HTMLInputElement;
    expect(box.checked).toBe(true);
    fireEvent.click(box);
    expect(box.checked).toBe(false);
    expect(renderHook(() => useMyStamp()).result.current).toBeNull();
    fireEvent.click(box);
    expect(renderHook(() => useMyStamp()).result.current).toBe("https://pics.example/me.png");
  });
});

describe("the stamp on a back", () => {
  it("is the player's own picture, and there is none for a player with no picture", () => {
    expect(renderHook(() => useMyStamp()).result.current).toBe("https://pics.example/me.png");
    me.pfpUrl = null;
    expect(renderHook(() => useMyStamp()).result.current).toBeNull();
  });

  it("is decoration (the back's facts say who holds the word), asks the picture's site for nothing about the player, and goes with a picture that fails to load", () => {
    const { container } = render(<CardStamp src="https://pics.example/me.png" ink="#e9b949" place="number" />);
    const stamp = container.querySelector(".cb-stamp")!;
    expect(stamp.getAttribute("aria-hidden")).toBe("true");
    expect(stamp.classList.contains("cb-stamp-number")).toBe(true);
    const img = stamp.querySelector("img")!;
    expect(img.getAttribute("alt")).toBe("");
    expect(img.getAttribute("referrerpolicy")).toBe("no-referrer");
    fireEvent.error(img);
    expect(container.querySelector(".cb-stamp")).toBeNull();
  });

  it("is drawn by the back in each of its three places, in one ink (the styles), and never by a fixed pixel size", () => {
    const back = readFileSync(join(process.cwd(), "src/components/cards/CardBack.tsx"), "utf8");
    for (const place of ["number", "corner", "mini"]) expect(back, place).toContain(`place="${place}"`);
    const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");
    const rule = (sel: string) => new RegExp(`\\${sel} \\{([^}]*)\\}`).exec(css)?.[1] ?? "";
    expect(rule(".cb-stamp-face img")).toMatch(/grayscale\(1\)/);
    expect(rule(".cb-stamp-face img")).toContain("mix-blend-mode: multiply");
    for (const place of ["number", "corner", "mini"]) {
      expect(rule(`.cb-stamp-${place}`), place).toMatch(/width: [\d.]+cqw/);
      expect(rule(`.cb-stamp-${place}`), place).toContain("rotate(-8deg)");
    }
  });
});
