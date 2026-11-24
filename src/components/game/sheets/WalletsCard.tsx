"use client";
/**
 * Your wallets: one account across several wallets (lib/db/walletLinks.ts on the server).
 *
 * Three states, one card:
 * - This wallet holds a link code from another wallet (made here before a wallet switch, or opened
 *   from a `?link=` URL on another device or in a Farcaster host): offer to link it.
 * - A code was just made here: say how to sign with the other wallet (switch wallets here, or open
 *   the link where that wallet lives), until it joins or the code expires.
 * - Otherwise: the account's wallets, with Unlink, and "Link another wallet".
 *
 * Linked wallets are public (one player on the Leaderboard and in the Dictionary), and letters stay
 * in the wallet that holds them; the card says both by the button, as Link X does.
 */
import { useEffect, useState } from "react";
import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { Button, Card } from "../primitives";
import { Check, CircleNotch, LinkSimple as LinkIcon, Wallet } from "../ui/icons";
import { useGame } from "../state";
import { useViewer } from "../useViewer";
import { PENDING_LINK_EVENT, readPendingLink, writePendingLink, type PendingLink, type useProfile } from "../useProfile";
import { SITE_URL } from "@/lib/site";

const MAX_WALLETS = 5;
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

const LINK_ERRORS: Record<string, string> = {
  too_many: "This account already has 5 wallets.",
  linked_elsewhere: "This wallet is already in another account. Unlink it there first.",
  has_wallets: "This wallet has wallets of its own linked. Unlink those first, or link the other way around.",
  has_profile: "This wallet has its own X link or email. Remove them in its profile first, then link it.",
  same_wallet: "That’s the wallet that made the link. Switch to the other wallet to link it.",
  stale_code: "That link expired or was already used. Make a new one from your other wallet.",
  bad_signature: "The signature didn’t match this wallet. Try again.",
  claimed_today: "This account took today’s free letter, so its wallets stay together until tomorrow (UTC).",
  first_wallet: "The account’s first wallet can’t leave. Unlink the others instead.",
  no_session: "Sign in with your wallet first.",
  rejected: "Not linked: you declined in your wallet.",
  not_configured: "Linking wallets isn’t switched on yet.",
};
const errorText = (code: string) => LINK_ERRORS[code] ?? "Something went wrong. Try again.";

export function WalletsCard({ p }: { p: ReturnType<typeof useProfile> }) {
  const { toast } = useGame();
  const viewer = useViewer();
  const { openAccountModal } = useAccountModal();
  const { openConnectModal } = useConnectModal();
  const address = p.address;
  const wallets = p.profile?.wallets?.length ? p.profile.wallets : address ? [address] : [];
  const account = p.profile?.account ?? address ?? null;
  const [pending, setPending] = useState<PendingLink | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // The pending code lives in localStorage (it must survive a wallet switch); follow it.
  useEffect(() => {
    const sync = () => setPending(readPendingLink());
    sync();
    window.addEventListener(PENDING_LINK_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(PENDING_LINK_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  // A code made by THIS wallet's account is the "waiting for the other wallet" state; once the
  // other wallet shows up in the account, the wait is over.
  const madeHere = Boolean(pending?.account && account && pending.account === account);

  if (!address) return null;

  const startLink = async () => {
    setNote(null);
    const r = await p.makeLinkCode();
    if ("error" in r) return setNote(errorText(r.error));
    writePendingLink({ code: r.code, account: r.account, expiresAt: r.expiresAt });
  };
  const join = async () => {
    if (!pending) return;
    setNote(null);
    const r = await p.joinWithCode(pending.code);
    if ("error" in r) {
      if (r.error === "stale_code") writePendingLink(null);
      return setNote(errorText(r.error));
    }
    writePendingLink(null);
    toast("Wallet linked: one bag, one profile", "good");
  };
  const unlink = async (w: string) => {
    setNote(null);
    const r = await p.unlinkWallet(w);
    if (r.error) return setNote(errorText(r.error));
    toast(`Unlinked ${short(w)}`, "info");
  };
  const linkUrl = pending ? `${SITE_URL}/play?link=${pending.code}` : "";
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(linkUrl);
      toast("Link copied", "good");
    } catch {
      setNote(linkUrl);
    }
  };
  const inHost = viewer.environment === "farcaster";

  // ── a code from another wallet, and this wallet isn't in that account yet ───────────────────
  // (Not "this wallet isn't in its wallet list": a wallet is always in its own. A code from a link URL
  // names no account; joining one that already holds this wallet is a harmless no-op.)
  if (pending && !madeHere) {
    return (
      <Card className="mb-3 bg-gold/10">
        <div className="mb-1 flex items-center gap-1.5 font-display font-extrabold">
          <LinkIcon weight="bold" /> Link this wallet?
        </div>
        <p className="text-sm text-ink/75">
          {pending.account ? (
            <>
              Your account <span className="font-mono text-xs">{short(pending.account)}</span> asked to link this wallet (
              <span className="font-mono text-xs">{short(address)}</span>).
            </>
          ) : (
            <>
              Your other wallet asked to link this one (<span className="font-mono text-xs">{short(address)}</span>).
            </>
          )}{" "}
          Sign to join one account: one bag, one profile, one free daily letter. It’s free and sends no transaction.
        </p>
        <div className="mt-2 flex gap-2">
          <Button size="sm" variant="teal" disabled={p.busy} onClick={() => void join()}>
            {p.busy ? <CircleNotch className="animate-spin" /> : "Link this wallet"}
          </Button>
          <Button size="sm" variant="ghost" disabled={p.busy} onClick={() => writePendingLink(null)}>
            Not now
          </Button>
        </div>
        {note && <p role="status" className="mt-2 text-xs font-bold text-candy-ink">{note}</p>}
      </Card>
    );
  }

  return (
    <Card className="mb-3">
      <div className="mb-1 font-display font-extrabold">Wallets</div>
      <div className="divide-y-2 divide-ink/10">
        {wallets.map((w) => {
          const here = w === address.toLowerCase();
          return (
            <div key={w} className="flex items-center gap-2.5 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-card">
                <Wallet weight="bold" size={14} />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-mono text-sm">{short(w)}</div>
                <div className="text-xs text-ink/55">{here ? "Connected now" : w === account && wallets.length > 1 ? "First wallet" : "Linked"}</div>
              </div>
              {wallets.length > 1 && w !== account && (
                <button onClick={() => void unlink(w)} disabled={p.busy} className="text-xs font-bold text-ink/45 underline">
                  Unlink
                </button>
              )}
            </div>
          );
        })}
      </div>

      {madeHere && pending ? (
        <div className="mt-2 rounded-xl border-2 border-dashed border-ink/25 p-3 text-sm text-ink/75">
          <div className="font-bold text-ink">Now sign with the other wallet</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {!inHost && <li>On this device: switch to it in your wallet app, or with Switch wallet below. This card then asks it to sign.</li>}
            <li>On another device, or in Farcaster: open the link there with that wallet connected.</li>
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {!inHost && (
              <Button size="sm" variant="ghost" onClick={() => (openAccountModal ?? openConnectModal)?.()}>
                Switch wallet
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => void copyLink()}>
              Copy link
            </Button>
            <button onClick={() => writePendingLink(null)} className="text-xs font-bold text-ink/45 underline">
              Cancel
            </button>
          </div>
          <p className="mt-2 text-xs text-ink/55">The link works once, for 15 minutes.</p>
        </div>
      ) : (
        wallets.length < MAX_WALLETS &&
        p.enabled && (
          <div className="mt-2">
            <Button size="sm" variant="ghost" disabled={p.busy} onClick={() => void startLink()}>
              {p.busy ? <CircleNotch className="animate-spin" /> : (
                <>
                  <LinkIcon weight="bold" /> Link another wallet
                </>
              )}
            </Button>
            <p className="mt-1.5 text-[11px] leading-snug text-ink/55">
              Linked wallets show publicly as one player, with one bag, one profile, and one free daily letter. Letters and
              words stay in the wallet that holds them: you play with the connected one.
            </p>
          </div>
        )
      )}
      {wallets.length > 1 && (
        <p className="mt-2 flex items-center gap-1 text-xs text-ink/55">
          <Check weight="bold" className="text-teal-ink" /> Your bag shows all {wallets.length} wallets.
        </p>
      )}
      {note && <p role="status" className="mt-2 text-xs font-bold text-candy-ink">{note}</p>}
    </Card>
  );
}
