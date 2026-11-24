/**
 * The Bag and the Showcase while the player's words aren't known (src/components/game/WordsPending.tsx):
 * loading says so, a failed read says it's a connection problem and offers Try again, and only a
 * known empty bag reaches the "no words yet" state (Bugbot on #164).
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { GameCtx, type GameApi } from "@/components/game/state";
import { WORDS_READ_FAILED, WordsPending, wordsUnknown } from "@/components/game/WordsPending";

const render = (state: { wordsLoading?: boolean; wordsError?: boolean }) =>
  renderToStaticMarkup(
    <GameCtx.Provider value={{ state, reloadWords: () => {} } as unknown as GameApi}>
      <WordsPending />
    </GameCtx.Provider>,
  );

describe("WordsPending", () => {
  it("knows when the words are unknown: loading, or the read failed", () => {
    expect(wordsUnknown({ wordsLoading: true })).toBe(true);
    expect(wordsUnknown({ wordsError: true })).toBe(true);
    expect(wordsUnknown({})).toBe(false);
  });

  it("says the words are on their way while they load", () => {
    expect(render({ wordsLoading: true })).toContain("Bringing out your words…");
  });

  it("says a failed read is a connection problem, with Try again", () => {
    const html = render({ wordsError: true });
    expect(html).toContain(WORDS_READ_FAILED);
    expect(html).toContain("Try again");
  });

  it("shows nothing once the words are known", () => {
    expect(render({})).toBe("");
  });
});
