// @vitest-environment jsdom
/**
 * A finished word's moments (TileCharacter's useFinishMoment; decisions.md #22): when they come,
 * how long they last, and that a new word on the same stage never inherits the last one's moment.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFinishMoment } from "@/components/game/TileCharacter";
import { MOMENT_END_S } from "@/components/game/TileFinish";

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no matchMedia; this viewer doesn't ask for reduced motion
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  vi.useRealTimers();
});

const at = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe("a finished word's moments", () => {
  it("comes soon after the word appears, lasts until its last effect ends, then rests", () => {
    const { result } = renderHook(() => useFinishMoment("Legendary", true, "FUNKY"));
    expect(result.current[0]).toBe(false);
    at(1300);
    expect(result.current[0]).toBe(true);
    at(MOMENT_END_S * 1000 - 200); // still on just before its last effect ends
    expect(result.current[0]).toBe(true);
    at(400);
    expect(result.current[0]).toBe(false);
  });

  it("never comes for a Common word, or while the word isn't active", () => {
    const common = renderHook(() => useFinishMoment("Common", true, "TEASE"));
    const away = renderHook(() => useFinishMoment("Mythic", false, "PUFFY"));
    at(20_000);
    expect(common.result.current[0]).toBe(false);
    expect(away.result.current[0]).toBe(false);
  });

  it("doesn't carry a moment over to the next word of the same tier", () => {
    const { result, rerender } = renderHook(({ word }) => useFinishMoment("Legendary", true, word), { initialProps: { word: "FUNKY" } });
    at(1300);
    expect(result.current[0]).toBe(true);
    // the stage moves on to another Legendary word mid-moment
    rerender({ word: "VIVID" });
    expect(result.current[0]).toBe(false);
    // it gets its own first moment, which the last word's timer doesn't cut short
    at(1300);
    expect(result.current[0]).toBe(true);
    at(MOMENT_END_S * 1000 - 400);
    expect(result.current[0]).toBe(true);
  });
});
