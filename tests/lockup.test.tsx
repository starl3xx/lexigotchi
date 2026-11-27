// @vitest-environment jsdom
/**
 * The lockup (lib/cardArt/logo `lockup`, components/brand/Lockup; decisions.md #55): the tile that is
 * the name's L, then EXIGOTCHI, alive where it is drawn live. starl3xx, 2026-11-27: "9E is
 * amazing", "let's not use the seal in the lockup", and, of a one-ink drawing on a dark ground,
 * "any time the colors are inverted like this, the colors of the eyes need to be inverted".
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { existsSync, readFileSync } from "node:fs";
import { LOCKUP, LOGO_A, lockup, nameAlone } from "@/lib/cardArt/logo";
import { svgDoc } from "@/lib/cardArt/engrave";
import { BLINK_MS, GLANCE_MS, Lockup } from "@/components/brand/Lockup";

const read = (p: string) => readFileSync(p, "utf8");
let reduce = false;
beforeEach(() => {
  reduce = false;
  window.matchMedia = ((q: string) => ({ matches: reduce && /reduce/.test(q), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the lockup's drawing", () => {
  const paper = lockup();
  it("is the tile and the name from E: one word, with no font, no text, and nothing fetched", () => {
    expect(paper.markup).not.toMatch(/<text|font-family|href=|<image/);
    // A's own tile, at the approved size, and the name after it in the game's ink
    expect(paper.markup).toContain(`scale(${(LOCKUP.tile / LOGO_A.ring.s).toFixed(4)})`);
    expect(paper.markup.match(new RegExp(`<path d="[^"]+" fill="${LOCKUP.ink}"/>`, "g"))).toHaveLength(1);
    expect(paper.height).toBe(LOCKUP.height);
    // nine letters wide, not ten: the tile is the L (ten letters set alone are wider than the whole lockup less its tile)
    expect(paper.width - LOCKUP.tile - LOCKUP.gap).toBeLessThan(nameAlone().width);
    expect([LOCKUP.cap, LOCKUP.tile, LOCKUP.gap, LOCKUP.track]).toEqual([100, 172, 15, -14]);
  });

  it("has no seal in it, in any form", () => {
    for (const l of [paper, lockup({ tone: "dark" }), lockup({ oneInk: true }), lockup({ tone: "dark", oneInk: true })]) expect(l.markup).not.toMatch(/<circle|<pattern|id="[\w-]*(au|bg|ln|disc|band)"/); // the seal is a ring of circles, a woven band, and gold
  });

  it("letters the name in paper on a dark ground, and keeps the tile as it is", () => {
    const dark = lockup({ tone: "dark" });
    expect(dark.markup).toContain(`fill="${LOCKUP.paper}"/></g>`);
    expect(dark.markup.split("<path d=")[1]).toBe(paper.markup.split("<path d=")[1]);
  });

  it("the eyes never invert: a light eyeball and a dark pupil on any ground", () => {
    const eyeballs = (m: string) => [...m.matchAll(/<ellipse cx="[\d.]+" cy="106" rx="44" ry="51" fill="(#\w+)"/g)].map((x) => x[1]);
    const pupils = (m: string) => [...m.matchAll(/<ellipse cx="[\d.]+" cy="[\d.]+" rx="22" ry="[\d.]+" fill="(#\w+)"/g)].map((x) => x[1]);
    // in colour: white, and the tile's ink
    expect(eyeballs(paper.markup)).toEqual(["#ffffff", "#ffffff"]);
    expect(pupils(paper.markup)).toEqual([LOGO_A.ink, LOGO_A.ink]);
    // One ink holds ONE colour: what is clear is cut out with a mask, never painted in a ground's colour.
    const colours = (m: string) => [...new Set([...m.matchAll(/(?:fill|stroke)="(#[0-9a-f]{6})"/g)].map((x) => x[1]))];
    // dark ink on light: the eyeball is clear inside its line, and the pupil is the ink (its pie cut taken out)
    const pos = lockup({ oneInk: true }).markup;
    expect(colours(pos)).toEqual([LOCKUP.ink]);
    expect(pos.match(/<ellipse cx="[\d.]+" cy="106" rx="44" ry="51" fill="none" stroke="#1b1714"/g)).toHaveLength(2);
    expect(pos.match(/<ellipse cx="[\d.]+" cy="[\d.]+" rx="22" ry="[\d.]+" fill="#1b1714" mask="url\(#eye[lr]\)"\/>/g)).toHaveLength(2);
    // light ink on dark: the eyeball is FILLED with the ink, and the pupil is taken out of it (black in its mask)
    const neg = lockup({ tone: "dark", oneInk: true }).markup;
    expect(colours(neg)).toEqual([LOCKUP.paper]);
    expect(neg.match(/<ellipse cx="[\d.]+" cy="106" rx="44" ry="51" fill="#f4ead2" stroke="#f4ead2" stroke-width="12" mask="url\(#eye[lr]\)"\/>/g)).toHaveLength(2);
    expect(neg.match(/<mask id="eye[lr]"[^>]*><rect[^>]*fill="#fff"\/><ellipse cx="[\d.]+" cy="[\d.]+" rx="22" ry="[\d.]+" fill="#000"\/><path d="[^"]+" fill="#fff"\/><\/mask>/g)).toHaveLength(2);
    // and in both, the tile's lines stop at the eyes
    for (const m of [pos, neg]) expect(m).toMatch(/<mask id="behind"[^>]*>.*?<\/mask><\/defs><g mask="url\(#behind\)"/);
  });

  it("only a living one carries the shut eyes, and a prefix makes every id its own", () => {
    expect(paper.markup).not.toContain("lk-shut");
    // and it hides them itself: the drawing is right with no stylesheet at all
    expect(lockup({ alive: true }).markup.match(/class="lk-shut" visibility="hidden"/g)).toHaveLength(2);
    const a = lockup({ prefix: "a-" }).markup;
    const ids = [...a.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);
    expect(ids.length).toBeGreaterThan(3);
    expect(ids.every((i) => i.startsWith("a-"))).toBe(true);
    expect([...a.matchAll(/url\(#([\w-]+)\)/g)].every((m) => ids.includes(m[1]))).toBe(true);
  });

  it("is what the files in docs/brand hold, and the notes name every file", () => {
    const doc = (l: { markup: string; width: number; height: number }) => svgDoc(l.markup, l.width, l.height);
    const file = (n: string) => read(`docs/brand/${n}`).trimEnd();
    expect(file("lockup.svg")).toBe(doc(lockup()));
    expect(file("lockup-on-dark.svg")).toBe(doc(lockup({ tone: "dark" })));
    expect(file("lockup-one-ink.svg")).toBe(doc(lockup({ oneInk: true })));
    expect(file("lockup-one-ink-on-dark.svg")).toBe(doc(lockup({ tone: "dark", oneInk: true })));
    expect(file("name.svg")).toBe(doc(nameAlone()));
    expect(file("name-on-dark.svg")).toBe(doc(nameAlone("dark")));
    for (const n of ["lockup", "lockup-on-dark", "lockup-one-ink", "lockup-one-ink-on-dark", "name", "name-on-dark"]) for (const h of [512, 128]) expect(existsSync(`docs/brand/${n}-${h}.png`), `${n}-${h}.png`).toBe(true);
    const notes = read("docs/brand/README.md");
    for (const n of ["lockup.svg", "lockup-on-dark.svg", "lockup-one-ink.svg", "lockup-one-ink-on-dark.svg", "name.svg", "name-on-dark.svg"]) expect(notes, n).toContain(n);
  });
});

describe("the lockup, drawn live", () => {
  const visible = (yes: boolean) => vi.spyOn(Element.prototype, "getClientRects").mockReturnValue((yes ? [{}] : []) as unknown as DOMRectList);

  it("gives two lockups on one page their own ids (the rail's and the header's are both in the page)", () => {
    const { container } = render(<><Lockup height={30} /><Lockup height={30} /></>);
    const [a, b] = [...container.querySelectorAll("svg.lk")];
    expect(a.getAttribute("aria-label")).toBe("Lexigotchi");
    const ids = (el: Element) => [...el.querySelectorAll("[id]")].map((n) => n.id);
    expect(ids(a).length).toBeGreaterThan(3);
    expect(ids(a).filter((i) => ids(b).includes(i))).toEqual([]);
  });

  it("blinks or glances in moments: a class for a moment, then nothing", () => {
    vi.useFakeTimers();
    visible(true);
    vi.spyOn(Math, "random").mockReturnValue(0.1); // a blink, twice
    const { container } = render(<Lockup alive height={30} />);
    const svg = container.querySelector("svg.lk")!;
    expect((svg.getAttribute("class") ?? "")).not.toMatch(/is-/);
    act(() => void vi.advanceTimersByTime(1400 + 0.1 * 1600));
    expect(svg.classList.contains("is-blink")).toBe(true);
    act(() => void vi.advanceTimersByTime(BLINK_MS));
    expect(svg.classList.contains("is-blink")).toBe(false);
    // the second blink of a pair comes and goes too
    act(() => void vi.advanceTimersByTime(280));
    expect((svg.getAttribute("class") ?? "")).not.toMatch(/is-/);
    // a glance: the next moment holds the pupils to one side, then lets go
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    let waited = 0;
    while (!/is-(left|right)/.test((svg.getAttribute("class") ?? "")) && waited < 10_000) {
      act(() => void vi.advanceTimersByTime(50));
      waited += 50;
    }
    expect((svg.getAttribute("class") ?? "")).toMatch(/is-(left|right)/);
    expect(svg.classList.contains("is-blink")).toBe(false);
    act(() => void vi.advanceTimersByTime(GLANCE_MS));
    expect((svg.getAttribute("class") ?? "")).not.toMatch(/is-/);
  });

  it.each([
    ["it is not alive", { alive: false, shown: true, less: false }],
    ["nobody can see it (the copy this screen's width hides)", { alive: true, shown: false, less: false }],
    ["the player asked for less motion", { alive: true, shown: true, less: true }],
  ])("does nothing when %s", (_name, c) => {
    vi.useFakeTimers();
    visible(c.shown);
    reduce = c.less;
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const { container } = render(<Lockup alive={c.alive} height={30} />);
    const svg = container.querySelector("svg.lk")!;
    const seen: string[] = [];
    for (let t = 0; t < 30_000; t += 50) {
      act(() => void vi.advanceTimersByTime(50));
      if (/is-/.test((svg.getAttribute("class") ?? ""))) seen.push((svg.getAttribute("class") ?? ""));
    }
    expect(seen).toEqual([]);
  });

  it("never loops inside the drawing, and a blink changes no size: its styles swap two drawings", () => {
    const css = read("src/app/globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => /\.lk[\s.]/.test(m[1] + " "));
    expect(rules.length).toBeGreaterThanOrEqual(6);
    for (const [, sel, body] of rules) expect(body, sel.trim()).not.toMatch(/animation|infinite|scale/);
    expect(css).toMatch(/\.lk\.is-blink \.lk-shut \{ visibility: visible; \}/);
    expect(css).toMatch(/\.lk\.is-blink \.lk-open \{ visibility: hidden; \}/);
  });
});

describe("where the name is drawn", () => {
  it("the six live places draw the lockup, alive in five and still in the landing page's footer", () => {
    const app = read("src/components/game/GameApp.tsx");
    expect(app.match(/<Lockup alive height=\{\d+\}[^>]*\/>/g)).toHaveLength(2); // the rail, and the phone's header
    // The phone header's lockup gives way when the row is tight, down to the old plain name's width:
    // at its full 132 px it pushed the profile button off a 390 px screen.
    expect(app).toMatch(/<span className="min-w-\[91px\] shrink md:hidden">\s*<Lockup alive height=\{28\} className="h-auto w-full" \/>/);
    // and only the lockup gives way: when its whole group could shrink, the chip beside it slid under the balance
    expect(app).not.toMatch(/<div className="flex min-w-0 items-center gap-1\.5">\s*\{\/\* The lockup/);
    expect(read("src/components/game/Onboarding.tsx")).toMatch(/<Lockup alive height=\{\d+\} \/>/);
    expect(read("src/components/game/screens/PreLaunchScreen.tsx")).toMatch(/<Lockup alive height=\{\d+\} \/>/);
    const landing = read("src/components/landing/LandingPage.tsx");
    expect(landing).toContain("<Lockup alive={!small} height={small ? 30 : 38} />");
    expect(landing).toContain("<Wordmark small />"); // the footer's
    // and none of them still sets the name in plain type
    for (const f of ["src/components/game/GameApp.tsx", "src/components/game/Onboarding.tsx", "src/components/game/screens/PreLaunchScreen.tsx", "src/components/landing/LandingPage.tsx"]) expect(read(f), f).not.toMatch(/>\s*L?EXIGOTCHI\s*</);
  });
});
