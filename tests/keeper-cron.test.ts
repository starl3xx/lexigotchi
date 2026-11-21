/**
 * The scheduled keeper (src/app/api/cron/keeper): who may trigger it, when it does nothing, and the
 * two rules that matter with one hot key: jobs run strictly one at a time, and one failing job
 * does not skip the rest.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.stubEnv("NEXT_PUBLIC_CHAIN_ID", "84532"); // the Sepolia registry has a deployed suite

const events: string[] = [];
let failing: string | null = null;
vi.mock("@/lib/keeper/jobs", async (orig) => {
  const real = await orig<typeof import("@/lib/keeper/jobs")>();
  return {
    ...real,
    createKeeper: () => ({
      run: async (job: string) => {
        events.push(`start:${job}`);
        await new Promise((r) => setTimeout(r, 5)); // a job that takes time, like a receipt wait
        events.push(`end:${job}`);
        if (job === failing) throw new Error(`${job} broke`);
      },
    }),
  };
});

const call = (auth?: string) =>
  new Request("http://localhost/api/cron/keeper", { headers: auth ? { authorization: auth } : {} });

beforeEach(() => {
  events.length = 0;
  failing = null;
  vi.stubEnv("CRON_SECRET", "s3cret");
  vi.stubEnv("KEEPER_PRIVATE_KEY", "0x" + "ab".repeat(32));
  vi.stubEnv("KEEPER_JOBS", "");
});

describe("jobsFrom", () => {
  it("defaults to resolve, yield, notify, and always runs in canonical order", async () => {
    const { jobsFrom } = await import("@/lib/keeper/jobs");
    expect(jobsFrom(undefined)).toEqual(["resolve", "yield", "notify"]);
    expect(jobsFrom("notify, bounty,resolve")).toEqual(["resolve", "bounty", "notify"]);
    expect(() => jobsFrom("resolve,payday")).toThrow(/payday/);
  });
});

describe("GET /api/cron/keeper", () => {
  it("refuses a caller without the cron secret", async () => {
    const { GET } = await import("@/app/api/cron/keeper/route");
    expect((await GET(call())).status).toBe(401);
    expect((await GET(call("Bearer wrong"))).status).toBe(401);
    expect(events).toEqual([]);
  });

  it("does nothing without a keeper key", async () => {
    vi.stubEnv("KEEPER_PRIVATE_KEY", "");
    const { GET } = await import("@/app/api/cron/keeper/route");
    const body = await (await GET(call("Bearer s3cret"))).json();
    expect(body).toEqual({ ok: true, skipped: "no_keeper_key" });
    expect(events).toEqual([]);
  });

  it("runs the jobs one at a time, in order", async () => {
    const { GET } = await import("@/app/api/cron/keeper/route");
    const res = await GET(call("Bearer s3cret"));
    expect(res.status).toBe(200);
    expect(events).toEqual(["start:resolve", "end:resolve", "start:yield", "end:yield", "start:notify", "end:notify"]);
  });

  it("keeps going after a failed job and reports it", async () => {
    failing = "yield";
    const { GET } = await import("@/app/api/cron/keeper/route");
    const res = await GET(call("Bearer s3cret"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.results).toEqual([
      { job: "resolve", ok: true },
      { job: "yield", ok: false, error: "yield broke" },
      { job: "notify", ok: true },
    ]);
    expect(events.at(-1)).toBe("end:notify");
  });
});

describe("redactSecrets", () => {
  it("removes the word and salt in plain, calldata-hex, and any-case forms", async () => {
    const { redactSecrets } = await import("@/lib/keeper/jobs");
    const word = "DOOZY";
    const salt = "0x8cfa90b07df0ab49ce7a4522e0468808a61d000e0fa1f602068023737349f6a3";
    const dump = `args: (DOOZY, ${salt}) data: 0xabcd${Buffer.from(word).toString("hex").toUpperCase()}00${salt.slice(2)}`;
    const out = redactSecrets(dump, word, salt);
    expect(out).not.toMatch(/doozy/i);
    expect(out.toLowerCase()).not.toContain(Buffer.from(word).toString("hex"));
    expect(out.toLowerCase()).not.toContain(salt.slice(2));
    expect(out).toContain("[WORD]");
    expect(out).toContain("[SALT]");
  });
});
