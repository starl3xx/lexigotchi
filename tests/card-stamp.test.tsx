// @vitest-environment jsdom
/**
 * The holder's picture, stamped on the back of their cards (decisions.md #48, part 6): one ink, an
 * engraved ring, beside the number; the player's own picture only, and theirs to turn off.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, renderHook } from "@testing-library/react";
import { LEDGER_LEFT, NUMBERED_HEADER, NUMBER_END, STAMP_FACE, STAMP_RING, inkRgb, numberedFrom, oneInk, stampBox, stampRingSvg } from "@/components/cards/stamp";
import { PLATE_BORDER } from "@/lib/cardArt/plate";
import { CARD_W } from "@/lib/cardArt/engrave";
import { LoopCancelled, loadImage } from "@/components/cards/loop/loadImage";

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
  it("on the back's picture, sits beside the number and left of the ledger; with no number, in the top left corner of the plate's field", () => {
    const beside = stampBox(true);
    const ring = (b: { size: number }) => (b.size / 2) * STAMP_RING;
    // clear of the number's last digit (the widest number's, measured on the picture) and of the ledger
    expect(beside.cx - ring(beside)).toBeGreaterThan(NUMBER_END + 0.005);
    expect(beside.cx + ring(beside)).toBeLessThan(LEDGER_LEFT - 0.01);
    // the ledger's left edge is the route's own arithmetic: its left margin, the left column, the gap
    const route = readFileSync(join(__dirname, "..", "src/app/s/[text]/back/route.tsx"), "utf8");
    expect(route).toContain("padding: `${7.5 * U}px ${7.3 * U}px ${8.3 * U}px`, gap: 4 * U }}");
    expect(route).toContain("width: 0.475 * (W - 18.6 * U)");
    expect(LEDGER_LEFT).toBeCloseTo((7.3 + 0.475 * (100 - 18.6) + 4) / 100, 4);
    // with no number: inside the plate's field, never on its border (it sat on the lace: Bugbot on #315)
    const corner = stampBox(false);
    const field = PLATE_BORDER.field / CARD_W;
    expect(corner.cx - corner.size / 2).toBeGreaterThan(field);
    expect(corner.cy - corner.size / 2).toBeGreaterThan(field);
    expect(corner.size).toBeLessThan(beside.size);
    expect(STAMP_FACE).toBeLessThan(1);
    expect(STAMP_RING).toBeCloseTo((54 + 3.2) / 60, 2); // the ring's petals, of the stamp's box
  });

  it("the game's own stamps stand inside the plate's field too, and the corner's is the video's", () => {
    const css = readFileSync(join(__dirname, "..", "src/app/globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const field = (PLATE_BORDER.field / CARD_W) * 100; // cqw
    const corner = /\n\.cb-stamp-corner \{ left: ([\d.]+)cqw; top: ([\d.]+)cqw; width: ([\d.]+)cqw;/.exec(css)!;
    const [left, top, width] = corner.slice(1).map(Number);
    expect(left).toBeGreaterThan(field);
    expect(top).toBeGreaterThan(field);
    const box = stampBox(false);
    expect(box.size * 100).toBeCloseTo(width, 5);
    expect((box.cx - box.size / 2) * 100).toBeCloseTo(left, 5);
    expect((box.cy - box.size / 2) * 100).toBeCloseTo(top, 5);
    // a thumbnail's
    const mini = /\n\.cb-stamp-mini \{ right: ([\d.]+)cqw; top: ([\d.]+)cqw;/.exec(css)!;
    expect(Number(mini[1])).toBeGreaterThan(field);
    expect(Number(mini[2])).toBeGreaterThan(field);
    // beside the number on a narrow back: smaller and higher, clear of the ledger's first row; and
    // left off where nothing fits (measured in WebKit: it covered "Case" under 296 px)
    expect(css).toMatch(/@container \(max-width: 339px\) \{[^@]*\.cb-stamp-number \{ width: 8\.6cqw; left: calc\(100% \+ 0\.6cqw\); transform: translateY\(-76%\) rotate\(-8deg\); \}/);
    expect(css).toMatch(/@container \(max-width: 295px\) \{\s*\.cb-body \.cb-stamp-number \{ display: none; \}/);
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

describe("the stamp in the share video", () => {
  const source = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("is placed by what the back's picture says of itself, never by what the game knows", () => {
    expect(numberedFrom(new Headers({ [NUMBERED_HEADER]: "1" }))).toBe(true);
    expect(numberedFrom(new Headers({ [NUMBERED_HEADER]: "0" }))).toBe(false);
    // a picture that doesn't say (one kept from before the header) gets no stamp: null, not a guess
    expect(numberedFrom(new Headers())).toBeNull();
    expect(numberedFrom(new Headers({ [NUMBERED_HEADER]: "yes" }))).toBeNull();
    const maker = source("src/components/cards/loop/makeLoop.ts");
    expect(maker).toContain("const numbered = numberedFrom(res.headers);");
    expect(maker).toContain("stamp && numbered !== null ? await stampedBack(backImg, stamp, await stampFace, numbered) : backImg");
    expect(maker).toContain("const box = stampBox(numbered);");
    // the game hands the video no opinion about the number
    expect(maker).not.toMatch(/numbered:\s*boolean;\s*\n\}/);
    expect(source("src/components/cards/ShareVideo.tsx")).not.toMatch(/numbered|useCardNumber/);
    // and the picture's route says it, from the very digits it draws
    expect(source("src/app/s/[text]/back/route.tsx")).toContain('[NUMBERED_HEADER]: digits ? "1" : "0"');
  });

  it("the holder's picture has a limit of its own and is asked for beside the card's faces, not after them", () => {
    const maker = source("src/components/cards/loop/makeLoop.ts");
    expect(maker).toContain("loadImage(stamp.src, { open: true, signal, ms: STAMP_WAIT_MS }).catch(() => null)");
    expect(maker.indexOf("const stampFace =")).toBeLessThan(maker.indexOf("loadBack(back, signal)"));
    expect(maker).toMatch(/const STAMP_WAIT_MS = \d{4};/);
  });
});

describe("a picture loaded for the video", () => {
  // jsdom never loads a picture: every load here is one that never answers
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("gives up after its limit, and stops asking", async () => {
    const seen: HTMLImageElement[] = [];
    const Real = window.Image;
    vi.stubGlobal("Image", function (this: HTMLImageElement) {
      const img = new Real();
      seen.push(img);
      return img;
    } as unknown as typeof Image);
    const load = loadImage("https://slow.example/me.png", { open: true, ms: 4000 });
    const failed = expect(load).rejects.toThrow(/took too long/);
    await vi.advanceTimersByTimeAsync(3999);
    expect(seen[0].getAttribute("src")).toBe("https://slow.example/me.png");
    expect(seen[0].crossOrigin).toBe("anonymous");
    await vi.advanceTimersByTimeAsync(2);
    await failed;
    expect(seen[0].getAttribute("src")).toBe("");
    vi.unstubAllGlobals();
  });

  it("stops the moment the video is called off, and never starts for one already called off", async () => {
    const off = new AbortController();
    const load = loadImage("https://slow.example/me.png", { signal: off.signal, ms: 60_000 });
    const failed = expect(load).rejects.toBeInstanceOf(LoopCancelled);
    off.abort();
    await failed;
    await expect(loadImage("https://slow.example/me.png", { signal: off.signal })).rejects.toBeInstanceOf(LoopCancelled);
    // nothing is left waiting
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("the back's picture, loaded for the video", () => {
  // The picture is made from fetched bytes, and its address stands for them. WebKit may read a
  // picture's pixels again from its address when it is drawn, so the address is kept until the
  // video is made: let go as soon as the picture loaded, the back could be drawn blank.
  const made: string[] = [];
  const gone: string[] = [];
  let fails = false;
  beforeEach(() => {
    made.length = 0;
    gone.length = 0;
    fails = false;
    vi.stubGlobal("fetch", async () => new Response(new Blob(["png"]), { headers: { [NUMBERED_HEADER]: "1" } }));
    URL.createObjectURL = () => (made.push(`blob:back-${made.length}`), made[made.length - 1]);
    URL.revokeObjectURL = (u: string) => void gone.push(u);
    // a picture that answers a moment after it is asked for (jsdom's never does)
    vi.stubGlobal("Image", function () {
      const img = document.createElement("img");
      Object.defineProperty(img, "src", { set: () => setTimeout(() => (fails ? img.onerror?.(new Event("error")) : img.onload?.(new Event("load"))), 0), get: () => "" });
      return img;
    } as unknown as typeof Image);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps its bytes until the caller lets them go, and says what the picture said of itself", async () => {
    const { loadBack } = await import("@/components/cards/loop/makeLoop");
    const back = await loadBack("/s/GLYPH/back?v=8");
    expect(back.numbered).toBe(true);
    expect(made).toEqual(["blob:back-0"]);
    // loaded, and still held
    expect(gone).toEqual([]);
    back.release();
    expect(gone).toEqual(["blob:back-0"]);
  });

  it("lets them go at once when the picture can't be made", async () => {
    const { loadBack } = await import("@/components/cards/loop/makeLoop");
    fails = true;
    await expect(loadBack("/s/GLYPH/back?v=8")).rejects.toThrow(/could not load/);
    expect(gone).toEqual(["blob:back-0"]);
  });

  it("the maker lets them go only after the last frame, whatever way the video ends", () => {
    const maker = readFileSync(join(process.cwd(), "src/components/cards/loop/makeLoop.ts"), "utf8");
    expect(maker).toMatch(/try \{\n\s+return await film\(\{[^}]+\}\);\n\s+\} finally \{\n\s+backLoaded\.release\(\);\n\s+\}/);
    // and a back that loaded beside a front that didn't is let go too
    expect(maker).toContain("backLoad.then((b) => b.release()).catch(() => {});");
  });
});
