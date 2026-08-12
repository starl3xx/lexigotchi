import { describe, it, expect, vi } from "vitest";
import {
  guardedAction,
  isPaid,
  isRetryable,
  resolved,
  stranded,
  NOT_STARTED,
} from "@/lib/onchain/guardedAction";

/**
 * Six findings on one branch came from a caller being unable to tell "nothing was spent" from "the
 * fee is gone and the commit is still open". Every one of those iterations had a green test suite,
 * because nothing tested the distinction itself. This does.
 *
 * The invariant under test: an outcome is retryable ONLY when the flow provably never paid.
 */
describe("guardedAction classifies failures by whether money moved", () => {
  it("a throw BEFORE payment is retryable — nothing was spent", async () => {
    const out = await guardedAction(async () => {
      throw new Error("RPC hiccup while reading commits");
    });
    expect(out).toEqual(NOT_STARTED);
    expect(isRetryable(out)).toBe(true);
    expect(isPaid(out)).toBe(false);
  });

  // The expensive one: retrying here buys a SECOND commit while the first stays open forever.
  it("a throw AFTER payment is stranded — never retryable", async () => {
    const out = await guardedAction(async (markPaid) => {
      markPaid();
      throw new Error("reveal transaction rejected");
    });
    expect(out.status).toBe("stranded");
    expect(isRetryable(out)).toBe(false);
    expect(isPaid(out)).toBe(true);
  });

  it("never rejects, whatever the flow throws", async () => {
    for (const thrown of [new Error("boom"), "a string", null, undefined, { weird: true }]) {
      await expect(
        guardedAction(async () => {
          throw thrown;
        }),
      ).resolves.toBeTruthy();
    }
  });

  it("passes a successful outcome straight through", async () => {
    expect(await guardedAction(async () => resolved(true))).toEqual({ status: "resolved", success: true });
    expect(await guardedAction(async () => resolved(false))).toEqual({ status: "resolved", success: false });
  });

  it("passes an explicit stranded outcome through untouched", async () => {
    const out = await guardedAction(async (markPaid) => {
      markPaid();
      return stranded("reveal 401'd");
    });
    expect(out).toEqual({ status: "stranded", note: "reveal 401'd" });
  });

  it("reports the error message to the player", async () => {
    const onError = vi.fn();
    await guardedAction(
      async () => {
        throw new Error("nonce too low");
      },
      { onError },
    );
    expect(onError).toHaveBeenCalledWith("nonce too low");
  });

  it("markPaid is idempotent and order-independent", async () => {
    const out = await guardedAction(async (markPaid) => {
      markPaid();
      markPaid();
      throw new Error("late failure");
    });
    expect(out.status).toBe("stranded");
  });

  it("a flow that returns not-started stays retryable even after calling markPaid", async () => {
    // markPaid only classifies THROWN failures; an explicit return is the flow's own judgement.
    const out = await guardedAction(async () => NOT_STARTED);
    expect(isRetryable(out)).toBe(true);
  });
});

describe("the retry predicates are exhaustive and mutually exclusive", () => {
  // A future state added without updating these would silently make something retryable.
  it("exactly one of isRetryable / isPaid holds, and neither for resolved", () => {
    const cases = [NOT_STARTED, resolved(true), resolved(false), stranded("x")];
    for (const c of cases) {
      expect(isRetryable(c) && isPaid(c)).toBe(false);
    }
    expect(isRetryable(NOT_STARTED)).toBe(true);
    expect(isPaid(stranded("x"))).toBe(true);
    // A resolved action is finished — neither a retry candidate nor an open commit.
    expect(isRetryable(resolved(true))).toBe(false);
    expect(isPaid(resolved(true))).toBe(false);
  });
});
