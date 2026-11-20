"use client";
/**
 * Browser push reminders for web players: turn on, turn off, and keep the server's copy pointed at
 * the connected wallet.
 *
 * Three rules shape it:
 *   - OPEN WEB ONLY. Inside a Farcaster or Base App host the host's own notifications apply
 *     (send.ts), so the state there is "unavailable" and nothing registers.
 *   - THE PERMISSION PROMPT ONLY ON A TAP. `enable()` calls Notification.requestPermission() first,
 *     before any await: Safari refuses a prompt that isn't inside the user's gesture, and a prompt
 *     on page load is how a site gets blocked for good.
 *   - NOTHING REGISTERS UNTIL THE PLAYER OPTS IN. The service worker (public/sw.js) is installed by
 *     `enable()`, not on page load; until then the hook only looks for an existing registration.
 *
 * Dark until configured: with no NEXT_PUBLIC_VAPID_PUBLIC_KEY the state is "unavailable" and the
 * toggle renders nothing. Also "unavailable" in the practice (mock) game, which has no onchain state
 * a reminder could describe.
 */
import { useCallback, useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useViewer } from "./useViewer";
import { webSession } from "@/lib/auth/siwfWeb";
import { isChainBacked } from "@/lib/onchain/gameMode";
import { iosNeedsHomeScreen } from "@/lib/notify/webPushSubscription";

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
/** What the server last stored for this browser: `${address}:${fid}`. Re-sent when it changes. */
const SYNCED_KEY = "lexigotchi:pushSynced";

export type PushState =
  | "unavailable" // not configured, inside a host, or still detecting
  | "no-wallet" // nothing to remind about yet
  | "unsupported" // this browser has no push
  | "needs-home-screen" // iPhone/iPad Safari: push only works from a Home Screen app
  | "denied" // the player blocked notifications for this site
  | "off"
  | "on"
  | "working";

function pushSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

function isIosBrowserTab(): boolean {
  if (typeof navigator === "undefined") return false;
  const standalone = (navigator as { standalone?: boolean }).standalone === true;
  return iosNeedsHomeScreen(navigator.userAgent, navigator.maxTouchPoints ?? 0, standalone);
}

/** VAPID keys travel as base64url; PushManager wants the raw bytes. */
function urlBase64ToUint8Array(b64: string): Uint8Array<ArrayBuffer> {
  const padded = (b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/");
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/** Store (or move) this browser's subscription. The Farcaster token, when present, attaches the FID. */
async function syncToServer(sub: PushSubscription, address: string): Promise<void> {
  const session = webSession();
  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(session ? { Authorization: `Bearer ${session.token}` } : {}),
    },
    body: JSON.stringify({ address, subscription: sub.toJSON() }),
  });
  if (!res.ok) throw Object.assign(new Error(`subscribe failed: ${res.status}`), { status: res.status });
  try {
    localStorage.setItem(SYNCED_KEY, `${address.toLowerCase()}:${session?.fid ?? ""}`);
  } catch {
    /* storage unavailable — we'll just re-sync next time */
  }
}

export function useWebPush(): { state: PushState; error: string | null; enable: () => void; disable: () => void } {
  const viewer = useViewer();
  const { address } = useAccount();
  const [base, setBase] = useState<"detecting" | "unsupported" | "needs-home-screen" | "denied" | "off" | "on">("detecting");
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The resync's own warning, kept apart from `error` so a wallet switch can clear just this one. */
  const [syncWarning, setSyncWarning] = useState<string | null>(null);

  // Only where reminders can fire: the practice (mock) game has no onchain words to warn about.
  const eligible = Boolean(VAPID_PUBLIC_KEY) && viewer.environment === "web" && isChainBacked();

  // Detect what this browser can do, and whether it is already subscribed.
  useEffect(() => {
    if (!eligible) return;
    if (!pushSupported()) return setBase(isIosBrowserTab() ? "needs-home-screen" : "unsupported");
    if (Notification.permission === "denied") return setBase("denied");
    let alive = true;
    currentSubscription()
      .then((sub) => alive && setBase(sub ? "on" : "off"))
      .catch(() => alive && setBase("off"));
    return () => {
      alive = false;
    };
  }, [eligible]);

  // Keep the server's copy on the connected wallet (and its Farcaster link, once there is one).
  // A tab that simply hasn't signed in to Farcaster is NOT a reason to re-sync: the web session is
  // tab-scoped, so its absence says nothing about the link (the server keeps the stored FID too).
  useEffect(() => {
    if (!eligible || base !== "on" || !address) return;
    let synced: string | null = null;
    try {
      synced = localStorage.getItem(SYNCED_KEY);
    } catch {
      /* treat as unsynced */
    }
    const [syncedAddress, syncedFid] = (synced ?? "").split(":");
    const walletChanged = syncedAddress !== address.toLowerCase();
    const newLink = viewer.fid != null && String(viewer.fid) !== syncedFid;
    if (!walletChanged && !newLink) {
      // Back on the wallet the server has (e.g. after a refused switch): nothing to warn about.
      setSyncWarning(null);
      return;
    }
    let alive = true; // a late answer for a wallet the player already left must not land
    void currentSubscription()
      .then(async (sub) => {
        if (!sub) return alive && setBase("off");
        await syncToServer(sub, address);
        if (alive) setSyncWarning(null);
      })
      .catch((err) => {
        // A full wallet refuses this browser (409): the server keeps it on the PREVIOUS wallet, so
        // the toggle's "on" is still true, but for that wallet. Say so; silence here would show
        // "on" for a wallet that gets nothing. Anything else is transient: the next visit retries.
        if (alive && (err as { status?: number }).status === 409) {
          setSyncWarning("Reminders stay with your previous wallet: this one already gets them in five browsers.");
        }
      });
    return () => {
      alive = false;
    };
  }, [eligible, base, address, viewer.fid]);

  const enable = useCallback(() => {
    if (!address) return;
    setError(null);
    setSyncWarning(null); // a fresh turn-on stores THIS wallet; any old switch warning is moot
    // FIRST, inside the tap: Safari drops a permission request that follows an await.
    const asked = Notification.requestPermission();
    setWorking(true);
    void (async () => {
      try {
        const permission = await asked;
        if (permission !== "granted") {
          setBase(permission === "denied" ? "denied" : "off");
          return;
        }
        const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        await navigator.serviceWorker.ready;
        const sub =
          (await reg.pushManager.getSubscription()) ??
          (await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
          }));
        try {
          await syncToServer(sub, address);
        } catch (err) {
          // The server never stored it, so nothing would ever arrive. Undo, and say so.
          await sub.unsubscribe().catch(() => {});
          throw err;
        }
        setBase("on");
      } catch (err) {
        console.error("[push] enable failed:", err);
        setError(
          (err as { status?: number }).status === 409
            ? "This wallet already gets reminders in five browsers. Turn them off in one of those first."
            : "Couldn’t turn on reminders. Try again in a moment.",
        );
      } finally {
        setWorking(false);
      }
    })();
  }, [address]);

  const disable = useCallback(() => {
    setError(null);
    setSyncWarning(null);
    setWorking(true);
    void (async () => {
      try {
        const sub = await currentSubscription();
        if (sub) {
          await fetch("/api/push/unsubscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: sub.endpoint }),
          }).catch(() => {});
          await sub.unsubscribe();
        }
        try {
          localStorage.removeItem(SYNCED_KEY);
        } catch {
          /* nothing to clear */
        }
        setBase("off");
      } catch (err) {
        console.error("[push] disable failed:", err);
        setError("Couldn’t turn off reminders. Try again in a moment.");
      } finally {
        setWorking(false);
      }
    })();
  }, []);

  let state: PushState;
  if (!eligible || base === "detecting") state = "unavailable";
  else if (working) state = "working";
  else if (!address && base !== "on") state = "no-wallet";
  else state = base;

  return { state, error: error ?? (state === "on" ? syncWarning : null), enable, disable };
}
