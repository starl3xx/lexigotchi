/**
 * The seeded jackpot schedule (src/lib/answerChain.ts) and the keeper's pre-reveal check
 * (src/lib/keeper/answerSchedule.ts). A seed small enough for a hosting secret is what lets a
 * scheduled keeper run without the 200+ KB schedule file.
 */
import { describe, it, expect } from "vitest";
import { buildAnswerChain, parseSeed, seededSchedule, verifyAnswerChain } from "@/lib/answerChain";
import { linkToReveal, loadAnswerSchedule } from "@/lib/keeper/answerSchedule";
import { isWord } from "@/lib/dictionary";
import { ANSWER_POOL_V1, ANSWER_POOL_V1_SHA256 } from "@/lib/answerPool";
import { createHash } from "node:crypto";

// Public test seeds only. A real seed never appears in code, logs, or chat.
const SEED_A = `0x${"11".repeat(32)}`;
const SEED_B = "22".repeat(32);

describe("seededSchedule", () => {
  it("is pinned: scheme v1 never silently reinterprets an existing seed", () => {
    // (Re-pinned 2026-11-21 when the pool was frozen at 4,584 words, before any production seed
    // existed. From here on the pool never changes, so neither may these values.)
    const built = buildAnswerChain(seededSchedule(SEED_A, 3));
    expect(built.links.map((l) => l.word)).toEqual(["YACHT", "SNAPS", "WREAK"]);
    expect(built.links[0].salt).toBe("0x8cfa90b07df0ab49ce7a4522e0468808a61d000e0fa1f602068023737349f6a3");
    expect(built.head).toBe("0x9db0e7881eff9ebf43590147b1d918f96bbb6d72516802325cdcc2c0bfe7c1e1");
  });

  it("shuffles the FROZEN pool, so a dictionary re-vendor can't move a future answer", () => {
    expect(createHash("sha256").update(ANSWER_POOL_V1.join("\n")).digest("hex")).toBe(ANSWER_POOL_V1_SHA256);
    expect(ANSWER_POOL_V1_SHA256).toBe("f830f138be8fa4b781f1b10b3c0ec2fc5b1e4f5e97ad6d758970b7ef15188cfb");
    expect(ANSWER_POOL_V1).toHaveLength(4584);
    expect([...ANSWER_POOL_V1]).toEqual([...new Set(ANSWER_POOL_V1)].sort());
    // Every answer must stay claimable: the live dictionary may grow, but must keep the whole pool.
    expect(ANSWER_POOL_V1.every((w) => isWord(w))).toBe(true);
    const words = (pool?: readonly string[]) => seededSchedule(SEED_A, 50, pool).map((e) => e.word);
    // The default IS the frozen pool…
    expect(words()).toEqual(words(ANSWER_POOL_V1));
    // …and that matters: a grown, re-sorted dictionary would have moved the answers.
    const grown = [...ANSWER_POOL_V1, "AAAAB", "MMMMN", "ZZZZY"].sort();
    expect(words(grown)).not.toEqual(words());
  });

  it("rebuilds the identical chain from the seed, every time", () => {
    const a = buildAnswerChain(seededSchedule(SEED_A, 730));
    const b = buildAnswerChain(seededSchedule(SEED_A, 730));
    expect(b.head).toBe(a.head);
    expect(b.links).toEqual(a.links);
    verifyAnswerChain(a); // walks forward exactly as AnswerChain.reveal would
  });

  it("gives a different seed a different chain", () => {
    expect(buildAnswerChain(seededSchedule(SEED_B, 30)).head).not.toBe(buildAnswerChain(seededSchedule(SEED_A, 30)).head);
  });

  it("draws distinct, claimable dictionary words, up to the whole dictionary", () => {
    const all = seededSchedule(SEED_A, ANSWER_POOL_V1.length);
    expect(new Set(all.map((e) => e.word)).size).toBe(ANSWER_POOL_V1.length);
    expect(all.every((e) => isWord(e.word))).toBe(true);
    expect(new Set(all.map((e) => e.salt)).size).toBe(ANSWER_POOL_V1.length);
    expect(() => seededSchedule(SEED_A, ANSWER_POOL_V1.length + 1)).toThrow();
    expect(() => seededSchedule(SEED_A, 0)).toThrow();
  });

  it("spreads day one across the dictionary (no obvious bias)", () => {
    const firsts = new Set<string>();
    for (let i = 0; i < 300; i++) firsts.add(seededSchedule(i.toString(16).padStart(64, "0"), 1)[0].word);
    expect(firsts.size).toBeGreaterThan(250); // 300 draws from 4,584 words rarely collide
  });

  it("refuses a seed that isn't 32 bytes of hex", () => {
    expect(() => parseSeed("abc")).toThrow();
    expect(() => parseSeed(`0x${"zz".repeat(32)}`)).toThrow();
    expect(parseSeed(SEED_A)).toHaveLength(32);
  });
});

describe("loadAnswerSchedule", () => {
  it("prefers the seed, with the day count from ANSWER_CHAIN_DAYS", () => {
    const s = loadAnswerSchedule({ ANSWER_CHAIN_SEED: SEED_A, ANSWER_CHAIN_DAYS: "3" }, () => {
      throw new Error("must not read a file when a seed is set");
    });
    expect(s.source).toBe("seed");
    expect(s.links[0].commit).toBe("0x9db0e7881eff9ebf43590147b1d918f96bbb6d72516802325cdcc2c0bfe7c1e1");
  });

  it("treats an empty ANSWER_CHAIN_DAYS as unset (the 730-day default)", () => {
    const fromEmpty = loadAnswerSchedule({ ANSWER_CHAIN_SEED: SEED_A, ANSWER_CHAIN_DAYS: "" });
    const fromDefault = loadAnswerSchedule({ ANSWER_CHAIN_SEED: SEED_A });
    expect(fromEmpty.links).toHaveLength(730);
    expect(fromEmpty.links[0].commit).toBe(fromDefault.links[0].commit);
  });

  it("falls back to the schedule file", () => {
    const built = buildAnswerChain(seededSchedule(SEED_B, 2));
    const s = loadAnswerSchedule({ ANSWER_CHAIN_FILE: "x.secret.json" }, () => JSON.stringify({ schedule: built.links }));
    expect(s.source).toBe("file");
    expect(s.links).toEqual(built.links);
  });
});

describe("linkToReveal", () => {
  const { links, head } = buildAnswerChain(seededSchedule(SEED_A, 5));

  it("returns today's link when it matches the onchain commit", () => {
    expect(linkToReveal(links, 0, head).day).toBe(1);
    expect(linkToReveal(links, 2, links[2].commit.toUpperCase().replace("0X", "0x")).day).toBe(3);
  });

  it("stops a wrong schedule before anything is sent, without leaking the word", () => {
    const wrong = buildAnswerChain(seededSchedule(SEED_B, 5));
    let msg = "";
    try {
      linkToReveal(wrong.links, 0, head);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/does not match the chain/);
    expect(msg).not.toContain(wrong.links[0].word);
    expect(msg).not.toContain(wrong.links[0].salt);
  });

  it("says when the schedule is used up", () => {
    expect(() => linkToReveal(links, 5, "0x00")).toThrow(/exhausted/);
  });
});
