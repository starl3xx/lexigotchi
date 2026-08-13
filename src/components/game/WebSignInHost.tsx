"use client";
/**
 * The Sign In With Farcaster approval UI for web players.
 *
 * Mounted once; listens for the SIGN_IN_EVENT that `useViewer().signIn()` fires. That indirection
 * keeps `signIn` a plain `() => void` so every existing call site works unchanged — and it replaces
 * the previous approach of querying the DOM for a hidden Neynar button and synthetically clicking
 * it, which mobile popup blockers defeated.
 *
 * Desktop scans the QR; mobile taps through to the Farcaster app. Both resolve the same channel.
 */
import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { beginWebSignIn } from "@/lib/auth/siwfWeb";
import { SESSION_EVENT, SIGN_IN_EVENT } from "./useViewer";
import { CircleNotch, Check, Warning } from "./ui/icons";

type Phase = "idle" | "starting" | "waiting" | "done" | "error";

export function WebSignInHost() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [url, setUrl] = useState("");
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");

  const close = useCallback(() => {
    setPhase("idle");
    setUrl("");
    setQr("");
    setError("");
  }, []);

  const start = useCallback(async () => {
    setPhase("starting");
    setError("");
    try {
      // A FRESH nonce per attempt — Quick Auth nonces are single-use, so a retry that reuses one
      // fails at the very last step with `invalid_nonce`.
      const handle = await beginWebSignIn();
      setUrl(handle.url);
      setQr(await QRCode.toDataURL(handle.url, { margin: 1, width: 220 }).catch(() => ""));
      setPhase("waiting");

      await handle.completed;
      setPhase("done");
      window.dispatchEvent(new Event(SESSION_EVENT));
      setTimeout(close, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
      setPhase("error");
    }
  }, [close]);

  useEffect(() => {
    const onRequest = () => {
      // Ignore a second tap while a channel is already open — starting another would burn a nonce
      // and leave the first QR pointing at a dead channel.
      setPhase((p) => (p === "idle" || p === "error" ? "starting" : p));
      void start();
    };
    window.addEventListener(SIGN_IN_EVENT, onRequest);
    return () => window.removeEventListener(SIGN_IN_EVENT, onRequest);
  }, [start]);

  if (phase === "idle") return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/70 px-4" onClick={close}>
      <div
        className="cel w-full max-w-sm rounded-2xl bg-paper p-5 text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-xl font-extrabold">Sign in with Farcaster</h2>

        {phase === "starting" && (
          <div className="mt-6 flex flex-col items-center gap-2 text-ink/60">
            <CircleNotch weight="bold" size={24} className="animate-spin" />
            <span className="text-sm">Opening a secure channel…</span>
          </div>
        )}

        {phase === "waiting" && (
          <>
            <p className="mt-1 text-sm text-ink/60">
              Scan with your phone, or tap through if you&apos;re already on it.
            </p>
            {qr && (
              <img
                src={qr}
                alt="Sign in with Farcaster QR code"
                className="mx-auto mt-4 rounded-xl border-[3px] border-ink"
                width={220}
                height={220}
              />
            )}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="cel mt-4 inline-block rounded-xl bg-candy px-4 py-2 text-sm font-extrabold text-paper"
            >
              Open Farcaster
            </a>
            <p className="mt-3 text-xs text-ink/45">Waiting for you to approve…</p>
          </>
        )}

        {phase === "done" && (
          <div className="mt-6 flex flex-col items-center gap-2 text-teal">
            <Check weight="bold" size={28} />
            <span className="font-display text-sm font-extrabold">Signed in</span>
          </div>
        )}

        {phase === "error" && (
          <>
            <div className="mt-4 flex flex-col items-center gap-2 text-candy">
              <Warning weight="bold" size={24} />
              <span className="text-sm">{error}</span>
            </div>
            <button
              onClick={() => void start()}
              className="cel mt-4 rounded-xl bg-candy px-4 py-2 text-sm font-extrabold text-paper"
            >
              Try again
            </button>
          </>
        )}

        <button onClick={close} className="mt-4 block w-full text-xs font-bold text-ink/45">
          Cancel
        </button>
      </div>
    </div>
  );
}
