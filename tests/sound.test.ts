// @vitest-environment jsdom
/**
 * The sound module (src/lib/sound.ts, decisions.md #49 part 4). What must hold:
 * - off by default, and OFF MEANS OFF: no sound file is fetched and no AudioContext is made;
 * - dark without its files: where the build has no sounds, nothing can turn it on;
 * - it never throws: a browser with no sound to give is silence.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Sound = typeof import("@/lib/sound");

class FakeSource {
  buffer: unknown = null;
  playbackRate = { value: 1 };
  connect = vi.fn((node: unknown) => node);
  start = vi.fn();
}
class FakeContext {
  static made = 0;
  static last: FakeContext | null = null;
  static sources: FakeSource[] = [];
  state: "running" | "suspended" = "suspended";
  destination = {};
  constructor() {
    FakeContext.made++;
    FakeContext.last = this;
  }
  resume = vi.fn(async () => void (this.state = "running"));
  suspend = vi.fn(async () => void (this.state = "suspended"));
  createBufferSource = () => {
    const s = new FakeSource();
    FakeContext.sources.push(s);
    return s;
  };
  createGain = () => ({ gain: { value: 1 }, connect: vi.fn((node: unknown) => node) });
  decodeAudioData = (_bytes: ArrayBuffer, done: (b: unknown) => void) => {
    done({ duration: 0.3 });
    return Promise.resolve({ duration: 0.3 });
  };
}

let fetched: string[];
async function load(ready: boolean): Promise<Sound> {
  vi.resetModules();
  if (ready) process.env.NEXT_PUBLIC_SOUND_READY = "1";
  else delete process.env.NEXT_PUBLIC_SOUND_READY;
  return import("@/lib/sound");
}
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  window.localStorage.clear();
  FakeContext.made = 0;
  FakeContext.sources = [];
  fetched = [];
  vi.stubGlobal("AudioContext", FakeContext);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      fetched.push(String(url));
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    }),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_SOUND_READY;
});

describe("off by default, and off means off", () => {
  it("is off for a player who chose nothing", async () => {
    const s = await load(true);
    expect(s.soundOn()).toBe(false);
  });

  it("with sound off, a cue makes no context and fetches no file", async () => {
    const s = await load(true);
    s.play("drop");
    s.play("hop", { rate: 1.2 });
    s.wakeSound();
    await settle();
    expect(FakeContext.made).toBe(0);
    expect(fetched).toEqual([]);
  });

  it("turning it off stops the cues", async () => {
    const s = await load(true);
    s.setSoundOn(true);
    await settle();
    s.setSoundOn(false);
    const before = FakeContext.sources.length;
    s.play("drop");
    await settle();
    expect(FakeContext.sources.length).toBe(before);
    expect(s.soundOn()).toBe(false);
    expect(window.localStorage.getItem("lexi-sound")).toBe("off");
  });
});

describe("turned on", () => {
  it("is remembered, wakes the browser's sound from that tap, and fetches the eight cues ahead", async () => {
    const s = await load(true);
    s.setSoundOn(true);
    await settle();
    expect(s.soundOn()).toBe(true);
    expect(window.localStorage.getItem("lexi-sound")).toBe("on");
    expect(FakeContext.made).toBe(1);
    expect(fetched.sort()).toEqual(s.CUES.map((c) => `/sfx/mail/${c}.mp3`).sort());
  });

  it("a later page finds it on, and still makes nothing until a tap or a cue", async () => {
    window.localStorage.setItem("lexi-sound", "on");
    const s = await load(true);
    expect(s.soundOn()).toBe(true);
    expect(FakeContext.made).toBe(0);
    expect(fetched).toEqual([]);
    s.wakeSound(); // the first tap
    await settle();
    expect(FakeContext.made).toBe(1);
    expect(fetched).toHaveLength(8);
  });

  it("plays a cue at its pitch, and each file is fetched once", async () => {
    const s = await load(true);
    s.setSoundOn(true);
    await settle();
    s.play("hop", { rate: 1.14 });
    s.play("hop", { rate: 1.21 });
    await settle();
    expect(FakeContext.sources.map((x) => x.playbackRate.value)).toEqual([1.14, 1.21]);
    expect(FakeContext.sources.every((x) => x.start.mock.calls.length === 1)).toBe(true);
    expect(fetched.filter((u) => u.endsWith("/hop.mp3"))).toHaveLength(1);
  });

  it("tells whoever listens", async () => {
    const s = await load(true);
    const heard = vi.fn();
    const stop = s.subscribeSound(heard);
    s.setSoundOn(true);
    s.setSoundOn(false);
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    s.setSoundOn(true);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it("plays nothing in a hidden tab", async () => {
    const s = await load(true);
    s.setSoundOn(true);
    await settle();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    s.play("drop");
    await settle();
    expect(FakeContext.sources).toHaveLength(0);
    hidden.mockRestore();
  });
});

describe("dark without its files", () => {
  it("nothing can turn it on in a build with no sounds", async () => {
    const s = await load(false);
    expect(s.SOUND_READY).toBe(false);
    s.setSoundOn(true);
    s.play("drop");
    await settle();
    expect(s.soundOn()).toBe(false);
    expect(FakeContext.made).toBe(0);
    expect(fetched).toEqual([]);
  });

  it("a stored “on” from a build that had sounds does nothing in one that has none", async () => {
    window.localStorage.setItem("lexi-sound", "on");
    const s = await load(false);
    expect(s.soundOn()).toBe(false);
  });
});

describe("it rests, except while something on screen is still going to play", () => {
  afterEach(() => vi.useRealTimers());
  const state = () => FakeContext.last?.state;

  it("rests a moment after the last cue, and a tap wakes it", async () => {
    vi.useFakeTimers();
    const s = await load(true);
    s.setSoundOn(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(state()).toBe("running");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(state()).toBe("suspended");
    s.wakeSound();
    await vi.advanceTimersByTimeAsync(50);
    expect(state()).toBe("running");
  });

  it("stays awake while an envelope is on screen: its stamp lands when the chain says so, not at a tap", async () => {
    vi.useFakeTimers();
    const s = await load(true);
    s.setSoundOn(true);
    const release = s.holdSound();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(state()).toBe("running");
    // the envelope goes: it rests as usual
    release();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state()).toBe("suspended");
  });

  it("two holds need two releases, and a release counts once", async () => {
    vi.useFakeTimers();
    const s = await load(true);
    s.setSoundOn(true);
    const a = s.holdSound();
    const b = s.holdSound();
    a();
    a(); // a second call of the same release does nothing
    await vi.advanceTimersByTimeAsync(30_000);
    expect(state()).toBe("running");
    b();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(state()).toBe("suspended");
  });

  it("a hold makes nothing while sound is off", async () => {
    const s = await load(true);
    const release = s.holdSound();
    await settle();
    expect(FakeContext.made).toBe(0);
    release();
  });
});

describe("it never throws", () => {
  it("a browser with no AudioContext is silence", async () => {
    vi.stubGlobal("AudioContext", undefined);
    const s = await load(true);
    expect(() => {
      s.setSoundOn(true);
      s.play("drop");
      s.wakeSound();
    }).not.toThrow();
    await settle();
    expect(fetched).toEqual([]);
  });

  it("a file that won't load is silence, and the game plays on", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    const s = await load(true);
    s.setSoundOn(true);
    expect(() => s.play("drop")).not.toThrow();
    await settle();
    expect(FakeContext.sources).toHaveLength(0);
  });

  it("a file that failed once is fetched again the next time: one bad moment doesn't silence the cue for the page's life", async () => {
    let down = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        fetched.push(String(url));
        if (down) throw new Error("offline");
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      }),
    );
    const s = await load(true);
    s.setSoundOn(true); // fetches all eight, and every one fails
    await settle();
    await settle();
    s.play("drop");
    await settle();
    expect(FakeContext.sources).toHaveLength(0);
    down = false;
    s.play("drop");
    await settle();
    await settle();
    expect(FakeContext.sources).toHaveLength(1);
    // and a file that loaded is not fetched again
    const before = fetched.filter((u) => u.endsWith("/drop.mp3")).length;
    s.play("drop");
    await settle();
    expect(fetched.filter((u) => u.endsWith("/drop.mp3")).length).toBe(before);
  });

  it("a storage that refuses keeps the default, off", async () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const s = await load(true);
    expect(s.soundOn()).toBe(false);
    get.mockRestore();
  });
});
