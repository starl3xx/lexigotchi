// @vitest-environment jsdom
/**
 * The name an envelope is addressed to (decisions.md #49; starl3xx: "@username (with the @) if they
 * have one", else "For you"). `useMyName` is `resolveIdentity(...).name`, and the mail sheet's own
 * test replaces that hook, so this holds the real rule: a handle with exactly one "@", or nothing.
 * Never a display name, a wallet address, or a bare username.
 */
import { describe, it, expect } from "vitest";
import { resolveIdentity } from "@/components/game/useProfile";

type Viewer = Parameters<typeof resolveIdentity>[0];
type Profile = Parameters<typeof resolveIdentity>[1];
const viewer = (over: Partial<Viewer> = {}): Viewer => ({ isAuthed: false, username: undefined, pfpUrl: undefined, ...over }) as Viewer;
const profile = (over: Record<string, unknown>): Profile => ({ x: null, nameSource: null, ...over }) as unknown as Profile;
const name = (v: Viewer, p: Profile) => resolveIdentity(v, p).name;

describe("the name an envelope is addressed to", () => {
  it("is the Farcaster handle, with one @", () => {
    expect(name(viewer({ isAuthed: true, username: "mabel" }), null)).toBe("@mabel");
    expect(name(viewer({ isAuthed: true, username: "mabel.base.eth" }), null)).toBe("@mabel.base.eth");
  });

  it("is the X handle for a player with only X", () => {
    expect(name(viewer(), profile({ x: { username: "mabel_x", pfpUrl: null } }))).toBe("@mabel_x");
  });

  it("is the account the player chose, when they linked both", () => {
    const both = profile({ x: { username: "mabel_x", pfpUrl: null }, nameSource: "x" });
    expect(name(viewer({ isAuthed: true, username: "mabel" }), both)).toBe("@mabel_x");
    expect(name(viewer({ isAuthed: true, username: "mabel" }), profile({ x: { username: "mabel_x", pfpUrl: null }, nameSource: "farcaster" }))).toBe("@mabel");
  });

  it("is nothing for a wallet with no linked account: the envelope says “For you”", () => {
    expect(name(viewer(), null)).toBeNull();
    expect(name(viewer(), profile({}))).toBeNull();
    // a Farcaster name that isn't signed in doesn't count
    expect(name(viewer({ isAuthed: false, username: "mabel" }), null)).toBeNull();
    // signed in, with no username
    expect(name(viewer({ isAuthed: true, username: "" }), null)).toBeNull();
  });

  it("always starts with exactly one @ when there is one", () => {
    const cases = [name(viewer({ isAuthed: true, username: "a" }), null), name(viewer(), profile({ x: { username: "b", pfpUrl: null } }))];
    for (const n of cases) expect(n).toMatch(/^@[^@\s]+$/);
  });
});
