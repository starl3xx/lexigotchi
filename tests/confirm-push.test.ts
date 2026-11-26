/**
 * The "Reminders are on" push must not be what breaks a new subscription (lib/notify/confirmPush.ts):
 * one "gone" answer drops nothing, and only a second one drops the row.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { CONFIRM_RETRY_MS, confirmSubscription } from "@/lib/notify/confirmPush";
import { sendWebPush } from "@/lib/notify/webPush";

type Answer = { ok: boolean; delivered?: number; gone?: number; failed?: number; skipped?: string };
function run(answers: Answer[]) {
  const sends: { prune: boolean }[] = [];
  const waits: number[] = [];
  const lines: string[] = [];
  const outcome = confirmSubscription({
    send: async (opts) => (sends.push(opts), answers[sends.length - 1]),
    wait: async (ms) => void waits.push(ms),
    log: (line) => lines.push(line),
  });
  return { outcome, sends, waits, lines };
}
const delivered: Answer = { ok: true, delivered: 1, gone: 0, failed: 0 };
const gone: Answer = { ok: true, delivered: 0, gone: 1, failed: 0 };
const failed: Answer = { ok: false, delivered: 0, gone: 0, failed: 1 };

describe("confirmSubscription", () => {
  it("one push when it is delivered, and that push may not drop the row", async () => {
    const r = run([delivered]);
    expect(await r.outcome).toBe("delivered");
    expect(r.sends).toEqual([{ prune: false }]);
    expect(r.waits).toEqual([]);
  });

  it("a first “gone” drops nothing: it waits, tries once more, and a delivered retry keeps the row", async () => {
    const r = run([gone, delivered]);
    expect(await r.outcome).toBe("delivered-on-retry");
    expect(r.sends).toEqual([{ prune: false }, { prune: true }]);
    expect(r.waits).toEqual([CONFIRM_RETRY_MS]);
    expect(r.lines.join(" ")).toMatch(/too early/);
  });

  it("gone twice drops the row, and says the screen may still say on", async () => {
    const r = run([gone, gone]);
    expect(await r.outcome).toBe("gone");
    expect(r.sends[1]).toEqual({ prune: true });
    expect(r.lines.at(-1)).toMatch(/dropped/);
  });

  it("a failure that isn’t “gone” is not retried, and the row is kept", async () => {
    const r = run([failed]);
    expect(await r.outcome).toBe("failed");
    expect(r.sends).toHaveLength(1);
  });

  it("says nothing while sends are muted", async () => {
    const r = run([{ ok: false, skipped: "muted" }]);
    expect(await r.outcome).toBe("skipped");
    expect(r.lines).toEqual([]);
  });
});

describe("the sender logs what the push service said, never the browser’s address", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
  });

  it("gone and failed pushes are logged with the status and the host only", async () => {
    Object.assign(process.env, { NODE_ENV: "production", WEB_PUSH_ENABLED: "true", NEXT_PUBLIC_VAPID_PUBLIC_KEY: "pub", VAPID_PRIVATE_KEY: "priv" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const sub = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/secret-token-${n}`, p256dh: "k", auth: "a" });
    const pruned: string[] = [];
    const res = await sendWebPush([sub(1), sub(2)], { title: "t", body: "b", notificationId: "n" }, {
      send: (async (s: { endpoint: string }) => {
        throw Object.assign(new Error("no"), { statusCode: s.endpoint.endsWith("-1") ? 410 : 403 });
      }) as never,
      onGone: async (endpoints) => void pruned.push(...endpoints),
    });
    expect(res).toMatchObject({ delivered: 0, gone: 1, failed: 1 });
    expect(pruned).toHaveLength(1);
    const said = [...warn.mock.calls, ...error.mock.calls].map((c) => c.join(" ")).join("\n");
    expect(said).toMatch(/gone: 410 from fcm\.googleapis\.com/);
    expect(said).toMatch(/send failed: 403 from fcm\.googleapis\.com/);
    expect(said).not.toMatch(/secret-token/);
  });
});
