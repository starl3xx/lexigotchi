import { describe, it, expect, afterEach, vi } from "vitest";
import { LIMITS, clamp, buildPayload, notificationsAreActive, sendNotification } from "@/lib/notify/send";
import {
  ALL_TITLE_POOLS,
  withinLimits,
  epochDay,
  hungerWarning,
  dailyReady,
  jackpotWon,
  jackpotRollover,
  earningsPaid,
  pityCapped,
  marketSold,
  remindersOn,
} from "@/lib/notify/templates";
import { NOTIFICATION_WEBHOOK_URL, farcasterManifest } from "@/lib/site";
import { HUNGER_WARN_HOURS } from "@/lib/notify/triggers";
import { DEFAULT_PARAMS } from "@/lib/params";

// A push cannot be recalled. Every test here guards a failure that is only visible AFTER it has
// already reached every player's phone.

// `vi.stubEnv` rather than assigning `process.env.NODE_ENV` — TS types it read-only, and stubbing
// restores cleanly even if an assertion throws mid-test.
const env = (node: string, enabled?: string, key?: string) => {
  vi.stubEnv("NODE_ENV", node);
  vi.stubEnv("NOTIFICATIONS_ENABLED", enabled ?? "");
  vi.stubEnv("NEYNAR_API_KEY", key ?? "");
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

/** One recorded fill of a listing, as templates read it (a lowercase w, 1.30M, unless said otherwise). */
const fill = (over: Partial<import("@/lib/notify/templates").SoldItem> = {}): import("@/lib/notify/templates").SoldItem => ({
  kind: "letter", name: "w", qty: 1, amount: 1_300_000, txHash: `0x${"d".repeat(64)}`, logIndex: 7, ...over,
});

describe("send guards", () => {
  it("refuses to send outside production, even with the flag on and a key present", () => {
    for (const stage of ["development", "test", "preview", "staging"]) {
      env(stage, "true", "key");
      expect(notificationsAreActive(), `${stage} must never send`).toBe(false);
    }
  });

  it("stays muted in production until the flag is explicitly 'true'", () => {
    for (const v of ["", "false", "1", "yes", "TRUE"]) {
      env("production", v, "key");
      expect(notificationsAreActive(), `flag=${v}`).toBe(false);
    }
    env("production", "true", "key");
    expect(notificationsAreActive()).toBe(true);
  });

  it("never issues a network call when inactive", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    env("test", "true", "key");
    const res = await sendNotification({ title: "t", body: "b" });
    expect(res.skipped).toBe("dev");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  // THE expensive bug: a targeted send whose audience filtered down to nobody must not become a
  // broadcast. "No one's words are hungry" would otherwise notify every player that theirs are.
  it("treats an empty target list as no-recipients, NOT as a broadcast", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    env("production", "true", "key");
    const res = await sendNotification({ title: "t", body: "b", targetFids: [] });
    expect(res.skipped).toBe("no-recipients");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("chunks a large audience into ≤100-FID requests", async () => {
    env("production", "true", "key");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const fids = Array.from({ length: 250 }, (_, i) => i + 1);
    await sendNotification({ title: "t", body: "b", targetFids: fids });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
    for (const call of fetchSpy.mock.calls) {
      const sent = JSON.parse(String((call[1] as RequestInit).body));
      expect(sent.target_fids.length).toBeLessThanOrEqual(LIMITS.fidsPerRequest);
    }
  });

  it("reports failure instead of throwing, so a bad push can't kill the keeper pass", async () => {
    env("production", "true", "key");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const res = await sendNotification({ title: "t", body: "b", targetFids: [1] });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("network down");
  });
});

describe("length limits", () => {
  it("clamps without splitting an emoji into a replacement character", () => {
    const out = clamp("🔵".repeat(40), 10);
    expect(out.length).toBeLessThanOrEqual(10);
    // A split surrogate pair shows up as a lone high/low surrogate; round-tripping catches it.
    expect([...out].every((ch) => ch.codePointAt(0)! < 0xd800 || ch.codePointAt(0)! > 0xdfff)).toBe(true);
  });

  it("leaves short strings untouched", () => {
    expect(clamp("Feeding time", LIMITS.title)).toBe("Feeding time");
  });

  it("clamps every field in the payload it actually sends", () => {
    const payload = buildPayload({
      title: "x".repeat(200),
      body: "y".repeat(500),
      notificationId: "z".repeat(300),
    });
    expect(payload.notification.title.length).toBeLessThanOrEqual(LIMITS.title);
    expect(payload.notification.body.length).toBeLessThanOrEqual(LIMITS.body);
    expect(payload.notification.uuid!.length).toBeLessThanOrEqual(LIMITS.notificationId);
  });

  // The LHAW bug, caught structurally: titles are static, so they fit for all inputs, forever.
  it("every title in every pool fits the 32-char budget", () => {
    for (const [name, pool] of Object.entries(ALL_TITLE_POOLS)) {
      for (const title of pool) {
        expect(title.length, `${name}: "${title}" is ${title.length}`).toBeLessThanOrEqual(LIMITS.title);
      }
    }
  });

  // Bodies DO interpolate, so fit has to hold under adversarial data, not just today's numbers.
  it("every template fits under adversarial substitutions", () => {
    const hugeAmount = "1,234,567,890,123 $WORD";
    const longWord = "z".repeat(40);
    for (let day = 0; day < 14; day++) {
      const built = [
        hungerWarning({ word: "ABOUT", words: 1, hoursLeft: 6 }, day),
        hungerWarning({ word: longWord, words: 2, hoursLeft: 6 }, day),
        hungerWarning({ word: longWord, words: 9999, hoursLeft: 24 }, day),
        dailyReady(day),
        jackpotWon(longWord, hugeAmount, day),
        jackpotRollover(hugeAmount, day),
        earningsPaid(hugeAmount, day),
        pityCapped("q", day),
        marketSold([fill({ kind: "word", name: "QUICK", amount: 999_990_000_000 })], day)!,
        marketSold([fill({ name: "Q", qty: 10_000, amount: 999_990_000_000 })], day)!,
        marketSold(Array.from({ length: 999 }, (_, i) => fill({ logIndex: i, amount: 999_990_000_000 })), day)!,
        remindersOn(),
      ];
      for (const n of built) {
        const payload = buildPayload({ ...n });
        expect(payload.notification.title.length).toBeLessThanOrEqual(LIMITS.title);
        expect(payload.notification.body.length).toBeLessThanOrEqual(LIMITS.body);
      }
    }
  });

  it("realistic copy fits without needing the clamp as a crutch", () => {
    expect(withinLimits(hungerWarning({ word: "FUNKY", words: 3, hoursLeft: 6 }))).toBe(true);
    expect(withinLimits(dailyReady())).toBe(true);
    expect(withinLimits(jackpotWon("cabin", "1,250,000 $WORD"))).toBe(true);
    expect(withinLimits(earningsPaid("42,000 $WORD"))).toBe(true);
  });
});

describe("template rotation", () => {
  it("rotates variants on consecutive days rather than repeating", () => {
    const seen = new Set<string>();
    for (let d = 0; d < 4; d++) seen.add(dailyReady(d).title);
    expect(seen.size).toBe(4);
  });

  it("is deterministic — the same day yields the same copy", () => {
    expect(dailyReady(500).title).toBe(dailyReady(500).title);
    expect(hungerWarning({ word: "FUNKY", words: 2, hoursLeft: 6 }, 7).title).toBe(hungerWarning({ word: "FUNKY", words: 2, hoursLeft: 6 }, 7).title);
  });

  it("keys idempotency per day so a retried cron cannot double-push", () => {
    expect(dailyReady(100).notificationId).toBe("daily-100");
    expect(dailyReady(101).notificationId).not.toBe(dailyReady(100).notificationId);
  });
});

// The client drops a repeated (id, FID) pair for 24h. That makes retries safe and makes coarse ids
// dangerous — a receipt keyed by day is a real notification the player silently never receives.
describe("idempotency keys match what the message describes", () => {
  it("NUDGES repeat their key within a day, so a retried pass can't double-push", () => {
    expect(hungerWarning({ word: "FUNKY", words: 3, hoursLeft: 6 }, 500).notificationId).toBe(hungerWarning({ word: "CRANE", words: 9, hoursLeft: 2 }, 500).notificationId);
    expect(pityCapped("q", 500).notificationId).toBe(pityCapped("q", 500).notificationId);
  });

  it("the payday receipt is keyed by its payout day: there is one payout a day (decisions.md #16)", () => {
    expect(earningsPaid("1 $WORD", 500).notificationId).toBe(earningsPaid("9 $WORD", 500).notificationId);
    expect(earningsPaid("1 $WORD", 500).notificationId).not.toBe(earningsPaid("1 $WORD", 501).notificationId);
  });

  it("nudges still separate across days and across letters", () => {
    expect(hungerWarning({ word: "FUNKY", words: 3, hoursLeft: 6 }, 500).notificationId).not.toBe(hungerWarning({ word: "FUNKY", words: 3, hoursLeft: 6 }, 501).notificationId);
    expect(pityCapped("q", 500).notificationId).not.toBe(pityCapped("z", 500).notificationId);
  });

  // The bug Bugbot caught: two fills of the same letter on the same day are two distinct trades.
  it("RECEIPTS key on the event, so a second sale of the same letter same day still notifies", () => {
    const a = marketSold([fill({ txHash: `0x${"a".repeat(64)}` })])!;
    const b = marketSold([fill({ txHash: `0x${"b".repeat(64)}` })])!;
    expect(a.notificationId).not.toBe(b.notificationId);
    expect(a.notificationId).not.toContain("500"); // not day-keyed at all
  });

  // A letter order fills in parts (decisions.md #30): the parts share an order hash, and can share a
  // transaction. Each is its own sale, so each is its own id: the client drops a repeated id for 24 h.
  it("two parts of ONE letter listing are two sales, each with its own id", () => {
    const tx = `0x${"c".repeat(64)}`;
    expect(marketSold([fill({ txHash: tx, logIndex: 4 })])!.notificationId).not.toBe(marketSold([fill({ txHash: tx, logIndex: 9 })])!.notificationId);
  });

  it("the same fill re-observed on another day stays deduped", () => {
    expect(marketSold([fill()], 500)!.notificationId).toBe(marketSold([fill()], 501)!.notificationId);
  });

  it("every id fits the 128-char budget, including a full transaction hash", () => {
    expect(marketSold([fill({ txHash: `0x${"f".repeat(64)}`, logIndex: 99_999 })])!.notificationId!.length).toBeLessThanOrEqual(LIMITS.notificationId);
  });

  it("a sale says what sold, for how much, and that the seller’s SHARE arrived (they keep 90%)", () => {
    expect(marketSold([fill({ kind: "word", name: "crane", amount: 2_400_000 })])!.body).toBe("CRANE found a new home, for 2.40M $WORD. Your share is in your wallet.");
    expect(marketSold([fill({ name: "q", amount: 96_300 })])!.body).toBe("Your q found a new home, for 96.3K $WORD. Your share is in your wallet.");
    expect(marketSold([fill({ name: "W", qty: 3, amount: 3_900_000 })])!.body).toBe("3 of your W found new homes, for 3.90M $WORD. Your share is in your wallet.");
    // several sales in one pass: one message, with the total
    expect(marketSold([fill({ amount: 1_000_000 }), fill({ kind: "word", name: "CRANE", amount: 2_400_000, logIndex: 8 })])!.body).toBe(
      "2 of your listings sold, for 3.40M $WORD in all. Your share is in your wallet.",
    );
    expect(marketSold([])).toBeNull();
  });

  it("epochDay agrees with the UTC epoch-day the contracts use", () => {
    expect(epochDay(new Date("2026-08-13T23:59:59Z"))).toBe(
      Math.floor(Date.UTC(2026, 7, 13) / 86_400_000),
    );
  });
});

describe("manifest wiring", () => {
  it("derives the webhook from our own Neynar client ID, not a pasted UUID", () => {
    expect(NOTIFICATION_WEBHOOK_URL).toBe(
      "https://api.neynar.com/f/app/9c8a6797-250e-4b54-ad22-039930877e8c/event",
    );
  });

  // Guards against ever inheriting a sibling project's app: sending through LHAW's UUID would
  // deliver Lexigotchi's pushes to LHAW's audience.
  it("is not LHAW's app", () => {
    expect(NOTIFICATION_WEBHOOK_URL).not.toContain("64ddc4ee-b993-4a64-bc76-b96af4a1ec32");
  });

  it("serves webhookUrl in both the miniapp and legacy frame blocks", () => {
    const m = farcasterManifest();
    expect(m.miniapp.webhookUrl).toBe(NOTIFICATION_WEBHOOK_URL);
    expect(m.frame.webhookUrl).toBe(NOTIFICATION_WEBHOOK_URL);
  });
});

// Bugbot #87: send.ts throws at import when armed without a key — correct fail-fast, but the admin
// status route and the Notifications tab exist to REPORT that exact state. If they reach the limits
// through send.ts, the one blocker they most need to surface is the one that makes them unreachable.
describe("limits are importable without the fail-fast throw", () => {
  it("exposes limits and clamp from a module with no import-time side effects", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NOTIFICATIONS_ENABLED", "true");
    vi.stubEnv("NEYNAR_API_KEY", ""); // the state that arms the throw in send.ts
    vi.resetModules();
    const mod = await import("@/lib/notify/limits");
    expect(mod.LIMITS.title).toBe(32);
    expect(mod.clamp("Feeding time", 32)).toBe("Feeding time");
  });

  it("is the module the status route and the tab import from", async () => {
    const [route, tab] = await Promise.all([
      import("node:fs").then((fs) =>
        fs.readFileSync("src/app/api/admin/notify-status/route.ts", "utf8"),
      ),
      import("node:fs").then((fs) =>
        fs.readFileSync("src/components/admin/tabs/NotificationsTab.tsx", "utf8"),
      ),
    ]);
    for (const [name, src] of [["status route", route], ["tab", tab]] as const) {
      expect(src, `${name} must not import from notify/send`).not.toMatch(
        /from ["']@\/lib\/notify\/send["']/,
      );
      expect(src, `${name} should import limits`).toMatch(/from ["']@\/lib\/notify\/limits["']/);
    }
  });
});

// The messaging guide (docs/messaging.md, decisions.md #24): reminders name the letter or word, in its
// case, and a jackpot line carries "staked and fed".
describe("reminders speak in the pet voice", () => {
  it("the hunger reminder names the word on the soonest clock, and counts the rest", () => {
    expect(hungerWarning({ word: "funky", words: 1, hoursLeft: 6 }).body).toBe(
      "FUNKY is peckish. Feed it within 6h, or it goes hungry and sits out the jackpot.",
    );
    expect(hungerWarning({ word: "FUNKY", words: 2, hoursLeft: 6 }).body).toContain("FUNKY and 1 more word are peckish");
    expect(hungerWarning({ word: "FUNKY", words: 4, hoursLeft: 6 }).body).toContain("FUNKY and 3 more words are peckish");
  });

  it("calls every warned word peckish only because the warning window sits inside the peckish stretch", () => {
    const { peckishAfterDays, hungryAfterDays } = DEFAULT_PARAMS.care;
    expect(HUNGER_WARN_HOURS).toBeLessThanOrEqual((hungryAfterDays - peckishAfterDays) * 24);
  });

  it("names a rolled letter lowercase, as it is while it rolls", () => {
    expect(pityCapped("Q").body).toContain("your q:");
  });

  it("says staked and fed wherever the jackpot is won or rolls over", () => {
    expect(jackpotWon("cabin", "1 $WORD").body).toContain("staked and fed");
    expect(jackpotRollover("1 $WORD").body).toContain("staked and fed");
  });
});
