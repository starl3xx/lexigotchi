import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { authorizeUrl, largerPfp, newState, parseXMe, pkcePair, redirectUri, stateReturn } from "@/lib/profile/x";
import { mergePublicFaces } from "@/lib/profile/rules";

describe("PKCE and state", () => {
  it("sends X only the S256 challenge of a secret verifier", () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
  });
  it("marks in the state where to land afterwards, and never repeats one", () => {
    expect(stateReturn(newState("page"))).toBe("page");
    expect(stateReturn(newState("redirect"))).toBe("redirect");
    expect(newState("redirect")).not.toBe(newState("redirect"));
  });
  it("builds X's consent URL with the exact scopes and S256", () => {
    const u = new URL(authorizeUrl({ clientId: "cid", redirectUri: "https://lexigotchi.fun/api/x/callback", state: "rabc", challenge: "ch" }));
    expect(u.origin + u.pathname).toBe("https://x.com/i/oauth2/authorize");
    expect(Object.fromEntries(u.searchParams)).toEqual({
      response_type: "code",
      client_id: "cid",
      redirect_uri: "https://lexigotchi.fun/api/x/callback",
      scope: "users.read tweet.read",
      state: "rabc",
      code_challenge: "ch",
      code_challenge_method: "S256",
    });
  });
});

describe("the callback URL", () => {
  afterEach(() => {
    delete process.env.X_REDIRECT_URI;
  });
  it("is https on the real domain and http on loopback (X wants 127.0.0.1 locally)", () => {
    expect(redirectUri("lexigotchi.fun")).toBe("https://lexigotchi.fun/api/x/callback");
    expect(redirectUri("127.0.0.1:3000")).toBe("http://127.0.0.1:3000/api/x/callback");
  });
  it("can be pinned to exactly what the X console has registered", () => {
    process.env.X_REDIRECT_URI = "https://lexigotchi.fun/api/x/callback";
    expect(redirectUri("127.0.0.1:3000")).toBe("https://lexigotchi.fun/api/x/callback");
  });
});

describe("reading X's /2/users/me", () => {
  const body = {
    data: { id: "1234567890123456789", username: "example_player", name: "Example Player", created_at: "2019-05-01T12:00:00.000Z", profile_image_url: "https://pbs.twimg.com/profile_images/1/abc_normal.jpg" },
  };
  it("takes the id, handle, name, creation date, and a sharper picture", () => {
    expect(parseXMe(body)).toEqual({
      id: "1234567890123456789",
      username: "example_player",
      name: "Example Player",
      pfpUrl: "https://pbs.twimg.com/profile_images/1/abc_400x400.jpg",
      createdAt: new Date("2019-05-01T12:00:00.000Z"),
    });
  });
  it("refuses a body without a numeric id or a username, and tolerates a missing date", () => {
    expect(parseXMe({ data: { ...body.data, id: "abc" } })).toBeNull();
    expect(parseXMe({ data: { id: "1" } })).toBeNull();
    expect(parseXMe({ errors: [{ title: "Unauthorized" }] })).toBeNull();
    expect(parseXMe({ data: { id: "1", username: "u" } })?.createdAt).toBeNull();
  });
  it("leaves a picture URL it doesn't recognize alone", () => {
    expect(largerPfp("https://pbs.twimg.com/profile_images/1/abc.png")).toBe("https://pbs.twimg.com/profile_images/1/abc.png");
    expect(largerPfp(null)).toBeNull();
  });
});

describe("the public name other players see", () => {
  const fc = { "0xaaa": { username: "fc_name", pfpUrl: "fc.png" } };
  const row = (nameSource: string | null, xUsername: string | null = "x_name") => ({ address: "0xAAA", xUsername, xPfpUrl: "x.png", nameSource });
  it("is Farcaster by default when both are linked", () => {
    expect(mergePublicFaces(fc, [row(null)])["0xaaa"]).toEqual({ username: "fc_name", pfpUrl: "fc.png", source: "farcaster" });
  });
  it("is X when the wallet chose X, or when X is the only one linked", () => {
    expect(mergePublicFaces(fc, [row("x")])["0xaaa"]).toEqual({ username: "x_name", pfpUrl: "x.png", source: "x" });
    expect(mergePublicFaces({}, [row(null)])["0xaaa"]).toMatchObject({ username: "x_name", source: "x" });
  });
  it("ignores a choice of X once X is unlinked, and shows nothing for a wallet with neither", () => {
    expect(mergePublicFaces(fc, [row("x", null)])["0xaaa"]).toMatchObject({ source: "farcaster" });
    expect(mergePublicFaces({}, [row("x", null)])).toEqual({});
  });
});
