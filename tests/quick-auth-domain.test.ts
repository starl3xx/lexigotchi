import { describe, it, expect } from "vitest";
import { quickAuthDomain } from "@/lib/auth/quickAuth";

const req = (host?: string) =>
  new Request("http://x/api", { headers: host ? { host } : {} });

/**
 * The loopback allowance that makes local SIWF sign-in possible — and its boundary. SIWF signs
 * the page's own host into the message, so localhost must verify as itself; but deriving the
 * audience from an arbitrary Host header would let a spoofed Host mint tokens for any audience.
 */
describe("quickAuthDomain", () => {
  const MANIFEST = quickAuthDomain(req()); // whatever SITE_URL resolves to in this env

  it("loopback hosts verify as themselves, port included", () => {
    expect(quickAuthDomain(req("localhost:3000"))).toBe("localhost:3000");
    expect(quickAuthDomain(req("localhost:3005"))).toBe("localhost:3005");
    expect(quickAuthDomain(req("localhost"))).toBe("localhost");
    expect(quickAuthDomain(req("127.0.0.1:3000"))).toBe("127.0.0.1:3000");
    expect(quickAuthDomain(req("[::1]:3000"))).toBe("[::1]:3000");
  });

  it("everything else pins to the manifest domain — a spoofed Host must not pick the audience", () => {
    for (const evil of [
      "evil.example",
      "lexigotchi.fun.evil.example",
      "localhost.evil.example",
      "localhost.evil.example:3000",
      "xlocalhost:3000",
      "127.0.0.2:3000",
    ]) {
      expect(quickAuthDomain(req(evil))).toBe(MANIFEST);
    }
  });

  it("a missing Host header falls back to the manifest domain", () => {
    expect(quickAuthDomain(req())).toBe(MANIFEST);
    expect(MANIFEST).not.toMatch(/localhost/);
  });

  it("normalizes case so the aud can't fork on casing", () => {
    expect(quickAuthDomain(req("LOCALHOST:3000"))).toBe("localhost:3000");
  });
});
