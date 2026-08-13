import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { LIMITS, clamp, buildPayload, notificationsAreActive, sendNotification } from "@/lib/notify/send";
import {
  ALL_TITLE_POOLS,
  withinLimits,
  epochDay,
  hungerWarning,
  dailyReady,
  jackpotWon,
  jackpotRollover,
  claimReady,
  pityCapped,
  listingFilled,
} from "@/lib/notify/templates";
import { NOTIFICATION_WEBHOOK_URL, farcasterManifest } from "@/lib/site";

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
        hungerWarning(1, 6, day),
        hungerWarning(9999, 24, day),
        dailyReady(day),
        jackpotWon(longWord, hugeAmount, day),
        jackpotRollover(hugeAmount, day),
        claimReady(hugeAmount, day),
        pityCapped("q", day),
        listingFilled("w", day),
      ];
      for (const n of built) {
        const payload = buildPayload({ ...n });
        expect(payload.notification.title.length).toBeLessThanOrEqual(LIMITS.title);
        expect(payload.notification.body.length).toBeLessThanOrEqual(LIMITS.body);
      }
    }
  });

  it("realistic copy fits without needing the clamp as a crutch", () => {
    expect(withinLimits(hungerWarning(3, 6))).toBe(true);
    expect(withinLimits(dailyReady())).toBe(true);
    expect(withinLimits(jackpotWon("cabin", "1,250,000 $WORD"))).toBe(true);
    expect(withinLimits(claimReady("42,000 $WORD"))).toBe(true);
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
    expect(hungerWarning(2, 6, 7).title).toBe(hungerWarning(2, 6, 7).title);
  });

  it("keys idempotency per day so a retried cron cannot double-push", () => {
    expect(dailyReady(100).notificationId).toBe("daily-100");
    expect(dailyReady(101).notificationId).not.toBe(dailyReady(100).notificationId);
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
