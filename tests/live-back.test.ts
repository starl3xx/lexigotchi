// @vitest-environment jsdom
/**
 * A card back's live material (components/cards/live): drawn on demand, never in a loop. One frame
 * per change however many changes came in it, nothing at rest, a sweep that ends, and one context at
 * a time, let go when the back leaves. OGL is stubbed: what's under test is when frames are drawn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const renders = { n: 0 };
const lost = { n: 0 };
vi.mock("ogl", () => {
  class Renderer {
    gl: { canvas: { width: number; height: number }; getExtension: (n: string) => unknown };
    constructor() {
      this.gl = { canvas: { width: 1, height: 1 }, getExtension: (n: string) => (n === "WEBGL_lose_context" ? { loseContext: () => void lost.n++ } : null) };
    }
    setSize(w: number, h: number) {
      this.gl.canvas.width = w;
      this.gl.canvas.height = h;
    }
    render() {
      renders.n++;
    }
  }
  class Program {
    uniforms: Record<string, { value: unknown }>;
    constructor(_gl: unknown, o: { uniforms: Record<string, { value: unknown }> }) {
      this.uniforms = o.uniforms;
    }
  }
  return { Renderer, Program, Mesh: class {}, Triangle: class {} };
});
const { attachSurface, SWEEP_MS } = await import("@/components/cards/live/liveSurface");
const { lightFromTilt, makeTiltFilter, REST_LIGHT, TILT_MIN_MS } = await import("@/components/cards/live/tilt");

// animation frames on fake timers, 16 ms apart
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance", "Date"] });
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => setTimeout(() => cb(performance.now()), 16) as unknown as number);
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
  renders.n = 0;
  lost.n = 0;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const canvas = () => {
  const host = document.createElement("div");
  const c = document.createElement("canvas");
  host.appendChild(c);
  return c;
};

describe("a live back", () => {
  it("draws once when it starts, then nothing at rest", () => {
    const s = attachSurface(canvas(), "legendary")!;
    vi.advanceTimersByTime(100);
    expect(renders.n).toBe(1);
    vi.advanceTimersByTime(5000);
    expect(renders.n).toBe(1);
    s.destroy();
  });

  it("draws one frame for many light moves in the same frame", () => {
    const s = attachSurface(canvas(), "rare")!;
    vi.advanceTimersByTime(100);
    renders.n = 0;
    for (let i = 0; i < 20; i++) s.light(i / 20, 0.5);
    vi.advanceTimersByTime(20);
    expect(renders.n).toBe(1);
    s.destroy();
  });

  it("sweeps the light once, then stops", () => {
    const s = attachSurface(canvas(), "mythic")!;
    vi.advanceTimersByTime(100);
    renders.n = 0;
    s.sweep();
    vi.advanceTimersByTime(SWEEP_MS + 200);
    const swept = renders.n;
    expect(swept).toBeGreaterThan(10);
    vi.advanceTimersByTime(5000);
    expect(renders.n).toBe(swept);
    s.destroy();
  });

  it("lets its context go, and a second back lets the first go", () => {
    const a = attachSurface(canvas(), "uncommon")!;
    expect(lost.n).toBe(0);
    const b = attachSurface(canvas(), "common")!;
    expect(lost.n).toBe(1);
    b.destroy();
    expect(lost.n).toBe(2);
    a.destroy(); // already let go: nothing more
    expect(lost.n).toBe(2);
  });

  it("draws nothing after it's let go", () => {
    const s = attachSurface(canvas(), "legendary")!;
    vi.advanceTimersByTime(100);
    renders.n = 0;
    s.light(0.2, 0.2);
    s.destroy();
    vi.advanceTimersByTime(100);
    expect(renders.n).toBe(0);
  });
});

describe("a back that loses its context to another", () => {
  it("is told, once, so it can show its CSS material instead of a dead canvas", () => {
    const told = vi.fn();
    const a = attachSurface(canvas(), "rare", told)!;
    const b = attachSurface(canvas(), "mythic")!;
    expect(told).toHaveBeenCalledTimes(1);
    b.destroy();
    a.destroy();
    expect(told).toHaveBeenCalledTimes(1);
  });

  it("isn't told when it lets go itself", () => {
    const told = vi.fn();
    attachSurface(canvas(), "rare", told)!.destroy();
    attachSurface(canvas(), "mythic")!.destroy();
    expect(told).not.toHaveBeenCalled();
  });
});

describe("the tilt's frames", () => {
  it("draws nothing for a hand's tremor", () => {
    const moved = makeTiltFilter();
    expect(moved(0.5, 0.5, 0)).toBe(true); // the first reading draws
    let drawn = 0;
    for (let i = 1; i <= 300; i++) if (moved(0.5 + Math.sin(i) * 0.008, 0.5 + Math.cos(i * 1.3) * 0.008, i * 16)) drawn++;
    expect(drawn).toBe(0);
  });

  it("draws real moves, at most about 30 a second", () => {
    const moved = makeTiltFilter();
    let drawn = 0;
    // a steady tip across the back over one second, a reading every 16 ms
    for (let i = 0; i <= 60; i++) if (moved(0.2 + i * 0.01, 0.5, i * 16)) drawn++;
    expect(drawn).toBeGreaterThan(10);
    expect(drawn).toBeLessThanOrEqual(1000 / TILT_MIN_MS + 1);
  });
});

describe("the tilt", () => {
  const held = { beta: 40, gamma: -8 };

  it("starts where the sweep left the light: the phone as it's held moves nothing", () => {
    expect(lightFromTilt(held, held)).toEqual([...REST_LIGHT]);
    expect(makeTiltFilter()(...lightFromTilt(held, held), 0)).toBe(false);
  });

  it("moves the light across as the phone tips left and right, and up and down as it tips toward you", () => {
    const [x] = lightFromTilt({ beta: 40, gamma: 2 }, held);
    expect(x).toBeGreaterThan(REST_LIGHT[0]);
    const [, y] = lightFromTilt({ beta: 50, gamma: -8 }, held);
    expect(y).toBeLessThan(REST_LIGHT[1]);
  });

  it("waits for the sweep: a tilt in the middle of it doesn't cut it short (Bugbot on #213)", () => {
    const s = attachSurface(canvas(), "legendary")!;
    vi.advanceTimersByTime(100);
    renders.n = 0;
    s.sweep();
    vi.advanceTimersByTime(SWEEP_MS / 4);
    s.nudge(0.9, 0.9); // a phone's reading, early
    vi.advanceTimersByTime(SWEEP_MS);
    // the sweep drew its whole second: about one frame each 16 ms
    expect(renders.n).toBeGreaterThan(SWEEP_MS / 16 - 5);
    // after it, a tilt moves the light
    renders.n = 0;
    s.nudge(0.6, 0.4);
    vi.advanceTimersByTime(20);
    expect(renders.n).toBe(1);
    s.destroy();
  });
});
