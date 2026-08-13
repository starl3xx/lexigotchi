// @vitest-environment jsdom
/**
 * The SIWF web sign-in overlay, tested for the two things that cost a real player something:
 * a burned single-use nonce, and a dismissed modal that reopens itself minutes later.
 *
 * `beginWebSignIn` watches the relay for up to five minutes and cannot be cancelled, so "the user
 * pressed Cancel" and "the attempt is still running" are both true at once. That overlap is what
 * these tests pin down.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { WebSignInHost } from "@/components/game/WebSignInHost";
import { SIGN_IN_EVENT, SESSION_EVENT } from "@/components/game/useViewer";

/** One controllable sign-in attempt, standing in for a relay channel. */
type Attempt = { resolve: (v: unknown) => void; reject: (e: Error) => void };
let attempts: Attempt[] = [];
const begin = vi.fn(async () => {
  let resolve!: (v: unknown) => void;
  let reject!: (e: Error) => void;
  const completed = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  attempts.push({ resolve, reject });
  return { url: `https://relay.test/channel/${attempts.length}`, completed };
});

vi.mock("@/lib/auth/siwfWeb", () => ({ beginWebSignIn: () => begin() }));
vi.mock("qrcode", () => ({ default: { toDataURL: async () => "data:image/png;base64,zz" } }));

beforeEach(() => {
  attempts = [];
  begin.mockClear();
});
afterEach(cleanup);

/** Fire the sign-in request and let the promise chain inside start() settle. */
async function requestSignIn() {
  await act(async () => {
    window.dispatchEvent(new Event(SIGN_IN_EVENT));
  });
}

describe("WebSignInHost does not burn nonces", () => {
  it("ignores a second request while an attempt is already open", async () => {
    render(<WebSignInHost />);
    await requestSignIn();
    await screen.findByText(/waiting for you to approve/i);

    // A double-tap, an impatient re-click, a second component dispatching the same event.
    await requestSignIn();
    await requestSignIn();

    // Each extra attempt would mint a fresh single-use nonce and orphan the QR on screen.
    expect(begin).toHaveBeenCalledTimes(1);
  });

  it("allows a fresh attempt after the player cancels", async () => {
    render(<WebSignInHost />);
    await requestSignIn();
    await screen.findByText(/waiting for you to approve/i);

    fireEvent.click(screen.getByText(/^cancel$/i));
    await requestSignIn();

    expect(begin).toHaveBeenCalledTimes(2);
  });

  it("allows a retry after a failure", async () => {
    render(<WebSignInHost />);
    await requestSignIn();
    await act(async () => attempts[0].reject(new Error("relay timed out")));

    expect(await screen.findByText(/relay timed out/i)).toBeTruthy();
    fireEvent.click(screen.getByText(/try again/i));
    await waitFor(() => expect(begin).toHaveBeenCalledTimes(2));
  });
});

describe("WebSignInHost does not resurrect a dismissed attempt", () => {
  it("stays closed when an abandoned attempt fails later", async () => {
    render(<WebSignInHost />);
    await requestSignIn();
    await screen.findByText(/waiting for you to approve/i);
    fireEvent.click(screen.getByText(/^cancel$/i));

    // Minutes later, the orphaned relay watch gives up. The player is long gone.
    await act(async () => attempts[0].reject(new Error("relay timed out")));

    expect(screen.queryByText(/relay timed out/i)).toBeNull();
    expect(screen.queryByText(/sign in with farcaster/i)).toBeNull();
  });

  it("does not overwrite a newer attempt's QR when an old one resolves", async () => {
    render(<WebSignInHost />);
    await requestSignIn();
    fireEvent.click(screen.getByText(/^cancel$/i));
    await requestSignIn(); // second channel — this is the one on screen

    const link = await screen.findByText(/open farcaster/i);
    expect(link.getAttribute("href")).toBe("https://relay.test/channel/2");

    await act(async () => attempts[0].resolve({ fid: 1, token: "t", expiresAt: 0 }));
    expect(screen.queryByText(/^signed in$/i)).toBeNull();
    expect(link.getAttribute("href")).toBe("https://relay.test/channel/2");
  });

  it("still publishes the session when an abandoned attempt is approved", async () => {
    // The player did approve — the credential is real and already stored. Discarding it would make
    // them sign in twice for no reason.
    const onSession = vi.fn();
    window.addEventListener(SESSION_EVENT, onSession);
    render(<WebSignInHost />);
    await requestSignIn();
    fireEvent.click(screen.getByText(/^cancel$/i));

    await act(async () => attempts[0].resolve({ fid: 7, token: "t", expiresAt: 0 }));
    expect(onSession).toHaveBeenCalled();
    window.removeEventListener(SESSION_EVENT, onSession);
  });
});

describe("WebSignInHost happy path", () => {
  it("confirms and announces the session", async () => {
    const onSession = vi.fn();
    window.addEventListener(SESSION_EVENT, onSession);
    render(<WebSignInHost />);
    await requestSignIn();

    expect(await screen.findByAltText(/QR code/i)).toBeTruthy();
    await act(async () => attempts[0].resolve({ fid: 7, token: "t", expiresAt: 0 }));

    expect(screen.getByText(/^signed in$/i)).toBeTruthy();
    expect(onSession).toHaveBeenCalled();
    window.removeEventListener(SESSION_EVENT, onSession);
  });
});
