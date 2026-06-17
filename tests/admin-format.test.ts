import { describe, it, expect } from "vitest";
import {
  usdToWord,
  usdToWordWei,
  wordToWei,
  fmtWordCompact,
  fmtBps,
  isAddress,
  isBytes32,
  shortAddr,
  WEI,
} from "@/lib/admin/format";

// $WORD is an 18-decimal ERC-20; the operator thinks in USD, the chain stores $WORD-wei.
const TEN18 = 10n ** 18n;

describe("USD ↔ $WORD-wei peg", () => {
  it("scales whole $WORD to 18 decimals", () => {
    expect(wordToWei(1)).toBe("1000000000000000000");
    expect(wordToWei(0)).toBe("0");
    expect(WEI).toBe(TEN18);
  });

  it("rounds to whole $WORD before scaling (no fractional wei)", () => {
    expect(wordToWei(2.4)).toBe((2n * TEN18).toString());
    expect(wordToWei(2.6)).toBe((3n * TEN18).toString());
  });

  it("usdToWordWei is always an exact multiple of 1e18", () => {
    for (const usd of [0, 1, 5, 7, 13.37]) {
      expect(BigInt(usdToWordWei(usd)) % TEN18).toBe(0n);
    }
    expect(usdToWordWei(0)).toBe("0");
  });

  it("usdToWordWei == wordToWei(round(usdToWord)) at the same peg", () => {
    for (const usd of [1, 5, 9, 100]) {
      expect(usdToWordWei(usd)).toBe(wordToWei(Math.round(usdToWord(usd))));
    }
  });
});

describe("fmtWordCompact rollover thresholds", () => {
  it("rolls K→M at 999_950 so it never prints a four-digit '1000.0K'", () => {
    expect(fmtWordCompact(999_949)).toBe("999.9K");
    expect(fmtWordCompact(999_950)).toBe("1.00M");
  });

  it("rolls M→B at 999_995_000 so it never prints a four-digit '1000.00M'", () => {
    expect(fmtWordCompact(999_994_999)).toBe("999.99M");
    expect(fmtWordCompact(999_995_000)).toBe("1.00B");
  });

  it("formats representative magnitudes", () => {
    expect(fmtWordCompact(999)).toBe("999");
    expect(fmtWordCompact(1_000)).toBe("1.0K");
    expect(fmtWordCompact(4_242_224)).toBe("4.24M");
  });

  it("returns '0' for non-finite input", () => {
    expect(fmtWordCompact(NaN)).toBe("0");
    expect(fmtWordCompact(Infinity)).toBe("0");
  });
});

describe("misc formatters + validators", () => {
  it("fmtBps drops decimals only when the bps value is whole percent", () => {
    expect(fmtBps(2500)).toBe("25%");
    expect(fmtBps(250)).toBe("2.50%");
  });

  it("isAddress / isBytes32 accept canonical input, trim, and reject malformed", () => {
    const addr = "0x" + "a".repeat(40);
    expect(isAddress(addr)).toBe(true);
    expect(isAddress(`  ${addr}  `)).toBe(true);
    expect(isAddress("0x123")).toBe(false);
    expect(isBytes32("0x" + "b".repeat(64))).toBe(true);
    expect(isBytes32(addr)).toBe(false);
  });

  it("shortAddr abbreviates and handles empty", () => {
    expect(shortAddr("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
    expect(shortAddr(null)).toBe("—");
  });
});
