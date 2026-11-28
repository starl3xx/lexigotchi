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
 * Linked wallets are public (one player on the leaderboard, with the account's name and picture),
 * and letters stay in the wallet that holds them; the card says both by the button, as Link X does.
 *
 * Move here (lib/onchain/move.ts): each wallet shows what it holds, and the CONNECTED wallet can send
 * its letters and held words to another wallet in the account. Only the holder can send, so another
 * wallet's row just says to switch to it.
 */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { readCaretakers } from "@/lib/onchain/reads";
import { useAccountModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useDisconnect } from "wagmi";
import { Button, Card } from "../primitives";
import { Check, CircleNotch, LinkSimple as LinkIcon, Wallet } from "../ui/icons";
import { useGame } from "../state";
import { useViewer } from "../useViewer";
import { PENDING_LINK_EVENT, readPendingLink, writePendingLink, type PendingLink, type useProfile } from "../useProfile";
import { SITE_URL } from "@/lib/site";
import { holdingsText, movableCount, type WalletHoldings } from "@/lib/profile/gameWalletAdvice";
import { useWalletHoldings } from "../useWalletHoldings";
import { NETWORK } from "@/lib/onchain/network";

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
  claimed_today: "This account took today’s free letter or woke a word for free today, so its wallets stay together until tomorrow (UTC).",
  first_wallet: "The account’s first wallet can’t leave. Unlink the others instead.",
  farcaster_wallet: "This wallet joined through your Farcaster account. Remove its verification in Farcaster to take it out.",
  no_session: "Sign in with your wallet first.",
  rejected: "Not linked: you declined in your wallet.",
  not_configured: "Linking wallets isn’t switched on yet.",
};
const errorText = (code: string) => LINK_ERRORS[code] ?? "Something went wrong. Try again.";

const movable = movableCount;
const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;


export function WalletsCard({ p }: { p: ReturnType<typeof useProfile> }) {
  const { toast, state, moveToWallet, setCaretaker, busy } = useGame();
  const viewer = useViewer();
  const { openAccountModal } = useAccountModal();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const address = p.address;
  const wallets = p.profile?.wallets?.length ? p.profile.wallets : address ? [address] : [];
  const account = p.profile?.account ?? address ?? null;
  // Wallets your Farcaster account verified join on their own (lib/profile/farcasterWallets.ts).
  const viaFarcaster = new Set(p.profile?.viaFarcaster ?? []);
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
  const lower = (a?: string | null) => a?.toLowerCase() ?? null;
  const madeHere = Boolean(
    pending && (lower(pending.madeBy) === lower(address) || (pending.account && lower(pending.account) === lower(account))),
  );

  // A code from a link names no account: ask the server which one it joins before offering to sign,
  // so the card shows it (anyone can send a link; the player should see where the wallet goes).
  const needsAccount = Boolean(pending && !pending.account && address);
  useEffect(() => {
    if (!needsAccount || !pending || !address) return;
    let cancelled = false;
    void (async () => {
      try {
        const r = await fetch("/api/profile/wallets/message", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ code: pending.code, address }),
        });
        const d = (await r.json()) as { ok?: boolean; account?: string; error?: string };
        if (cancelled) return;
        if (d.ok && d.account) writePendingLink({ ...pending, account: d.account.toLowerCase() });
        else if (d.error === "stale_code" || r.status === 410) {
          writePendingLink(null);
          setNote(errorText("stale_code"));
        }
      } catch {
        /* offline: the button stays disabled until the account is known */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [needsAccount, pending, address]);

  // The offer sits below Linked accounts: on a phone, bring it into view when it appears.
  const offerRef = useRef<HTMLDivElement>(null);
  const showOffer = Boolean(address && pending && !madeHere);
  useEffect(() => {
    if (showOffer) offerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [showOffer]);

  // ── what each wallet holds (Move here) ──────────────────────────────────────────────────────
  // Letters: one balanceOfBatch per wallet. Words: the bag already reads every bag wallet's words
  // and tags each with its holder (undefined = the connected wallet), so no second log scan.
  const hold = useWalletHoldings();
  // Caretakers (Staking.setCaretaker): which of the other wallets may feed, roll, and ascend the
  // words the CONNECTED wallet stakes. Read for this wallet as the staker; each wallet sets its own.
  const careOthers = (wallets as string[]).filter((w) => w !== address?.toLowerCase());
  const caretakersQ = useQuery({
    queryKey: ["caretakers", NETWORK.id, address?.toLowerCase(), careOthers.join(",")],
    queryFn: async () => {
      const flags = await readCaretakers(careOthers.map((w) => ({ staker: address!.toLowerCase(), wallet: w })));
      return Object.fromEntries(careOthers.map((w, i) => [w, flags[i]])) as Record<string, boolean>;
    },
    enabled: state.chainBacked && !!address && careOthers.length > 0,
    staleTime: 30_000,
  });
  const [moving, setMoving] = useState(false);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [movedOnce, setMovedOnce] = useState(false);
  const [includeWord, setIncludeWord] = useState(false);
  // The game wallet (lib/db/gameWallet.ts): where the player keeps everything. A notice elsewhere
  // can open this sheet with focus "move", which opens the Move panel once.
  const gameWallet = p.profile?.gameWallet ?? null;
  const focusMove = state.sheet?.kind === "profile" && state.sheet.focus === "move";
  const focusedOnce = useRef(false);
  useEffect(() => {
    if (!focusMove || focusedOnce.current || !address || wallets.length < 2) return;
    if (movable(hold.holdings[address.toLowerCase()]) > 0) {
      focusedOnce.current = true;
      setMoving(true);
    }
  }, [focusMove, hold.holdings, address, wallets.length]);

  if (!address) {
    // A link arrived before a wallet: say what to do; the offer appears once one connects.
    return pending && !pending.madeBy ? (
      <Card className="mb-3 bg-gold/10">
        <div className="mb-1 flex items-center gap-1.5 font-display font-extrabold">
          <LinkIcon weight="bold" /> Link a wallet
        </div>
        <p className="text-sm text-ink/75">Connect the wallet you want to link. This card then asks it to sign.</p>
      </Card>
    ) : null;
  }

  const startLink = async () => {
    setNote(null);
    const r = await p.makeLinkCode();
    if ("error" in r) return setNote(errorText(r.error));
    writePendingLink({ code: r.code, account: r.account, expiresAt: r.expiresAt, madeBy: address });
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

  const holdingsOf = (w: string): WalletHoldings | undefined => hold.holdings[w];
  const here = address.toLowerCase();
  const others = wallets.filter((w) => w !== here);
  const hereHoldings = holdingsOf(here);
  // The destination: the player's pick, else the game wallet, else the only other wallet. Never a
  // wallet outside the account (the move re-checks the account fresh before it sends).
  const dest =
    moveTo && others.includes(moveTo)
      ? moveTo
      : gameWallet && others.includes(gameWallet)
        ? gameWallet
        : others.length === 1
          ? others[0]
          : null;
  const startMove = () => {
    setNote(null);
    setMoving(true);
    hold.refetch(); // the panel's counts, fresh
  };
  const makeGameWallet = async (w: string) => {
    setNote(null);
    const r = await p.setGameWallet(w);
    if (r.error) return setNote(errorText(r.error));
    toast(`Game wallet: ${short(w)}`, "good");
  };
  const doMove = async () => {
    if (!dest) return;
    const r = await moveToWallet(dest, { includeWord: includeWord && (hereHoldings?.word ?? 0) > 0 });
    if (r !== "sent" && r !== "failed") return; // refused before anything reached the wallet
    // The chain read lags a fresh transfer: re-read a few times so the rows settle. A failed send
    // may still have moved part (the letters, say, before a word was declined), so it re-reads too.
    for (const ms of [4_000, 10_000, 20_000]) setTimeout(() => hold.refetch(), ms);
    if (r !== "sent") return;
    setMoving(false);
    setMovedOnce(true);
  };
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
      <div ref={offerRef} className="scroll-mt-4">
        <Card className="mb-3 bg-gold/10">
          <div className="mb-1 flex items-center gap-1.5 font-display font-extrabold">
            <LinkIcon weight="bold" /> Link this wallet?
          </div>
          <p className="text-sm text-ink/75">
            {pending.account ? (
              <>
                Sign to add this wallet (<span className="font-mono text-xs">{short(address)}</span>) to the account{" "}
                <span className="font-mono text-xs">{short(pending.account)}</span>: one bag, one profile, and one free daily
                letter. Only link a wallet you own. It’s free and sends no transaction.
              </>
            ) : (
              <>Checking the link…</>
            )}
          </p>
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="teal" disabled={p.busy || !pending.account} onClick={() => void join()}>
              {p.busy ? <CircleNotch className="animate-spin" /> : "Link this wallet"}
            </Button>
            <Button size="sm" variant="ghost" disabled={p.busy} onClick={() => writePendingLink(null)}>
              Not now
            </Button>
          </div>
          {note && <p role="status" className="mt-2 text-xs font-bold text-candy-ink">{note}</p>}
        </Card>
      </div>
    );
  }

  const choosing = wallets.length > 1 && !gameWallet;
  return (
    <Card className="mb-3">
      <div className="mb-1 font-display font-extrabold">Wallets</div>
      {choosing && (
        <div className="mb-2 rounded-xl bg-gold/15 p-3 text-sm text-ink/80">
          <div className="font-bold text-ink">Choose your game wallet</div>
          <p className="mt-1">
            Your letters, words, and $WORD are onchain, in whichever wallet holds them. You can only spell, roll, stake, and
            wake with the connected wallet’s own. So pick one wallet to keep everything in, and play with it.
          </p>
          {inHost && (
            <p className="mt-1 text-xs text-ink/65">
              Inside Farcaster you can only use this Farcaster wallet ({short(here)}). If you play mostly here, choose it.
            </p>
          )}
        </div>
      )}
      <div className="divide-y-2 divide-ink/10">
        {wallets.map((w) => {
          const isHere = w === here;
          const h = holdingsOf(w);
          return (
            <div key={w} className="flex items-center gap-2.5 py-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-card">
                <Wallet weight="bold" size={14} />
              </span>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-sm">{short(w)}</span>
                  {w === gameWallet && wallets.length > 1 && (
                    <span className="rounded-full border-2 border-ink bg-teal/20 px-1.5 py-0.5 text-[10px] font-bold">Game wallet</span>
                  )}
                </div>
                <div className="text-xs text-ink/55">
                  {isHere
                    ? "Connected now"
                    : w === account && wallets.length > 1
                      ? "First wallet"
                      : viaFarcaster.has(w)
                        ? "Via Farcaster"
                        : "Linked"}
                  {h && <> · {holdingsText(h)}</>}
                </div>
                {/* Only a wallet whose things are in the wrong place gets the hint: never the game wallet. */}
                {!isHere && movable(h) > 0 && w !== gameWallet && (
                  <div className="mt-0.5 text-[11px] text-ink/50">
                    {inHost ? "Open Lexigotchi on the web with this wallet" : "Switch to this wallet"} to move them
                    {gameWallet ? " to your game wallet" : ""}.
                  </div>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {wallets.length > 1 && w !== gameWallet && (
                  <button
                    onClick={() => void makeGameWallet(w)}
                    disabled={p.busy}
                    className={`text-xs font-bold underline ${choosing ? "text-teal-ink" : "text-ink/45"}`}
                  >
                    Make game wallet
                  </button>
                )}
                {wallets.length > 1 && w !== account && !viaFarcaster.has(w) && (
                  <button onClick={() => void unlink(w)} disabled={p.busy} className="text-xs font-bold text-ink/45 underline">
                    Unlink
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {state.chainBacked && others.length > 0 && movable(hereHoldings) > 0 && !moving && (
        <div className="mt-2">
          <Button size="sm" variant="ghost" onClick={startMove}>
            {movedOnce ? "Move the rest" : gameWallet && gameWallet !== here ? "Move these to your game wallet" : "Move this wallet’s letters"}
          </Button>
        </div>
      )}
      {moving && hereHoldings && (
        <div className="mt-2 rounded-xl border-2 border-ink/25 p-3 text-sm text-ink/75">
          <div className="font-bold text-ink">Move to another wallet</div>
          {others.length > 1 ? (
            <div role="radiogroup" aria-label="Destination wallet" className="mt-1.5 space-y-1">
              {others.map((w) => (
                <label key={w} className="flex cursor-pointer items-center gap-2">
                  <input type="radio" name="move-to" checked={dest === w} onChange={() => setMoveTo(w)} />
                  <span className="break-all font-mono text-xs">{w}</span>
                </label>
              ))}
            </div>
          ) : (
            dest && <div className="mt-1 break-all font-mono text-xs text-ink">To {dest}</div>
          )}
          <p className="mt-2">
            {hereHoldings.letters + hereHoldings.words > 0 ? (
              <>
                Moves{" "}
                {[
                  hereHoldings.letters > 0 && plural(hereHoldings.letters, "letter", "letters"),
                  hereHoldings.words > 0 && plural(hereHoldings.words, "word", "words"),
                ]
                  .filter(Boolean)
                  .join(" and ")}
                .
              </>
            ) : (
              <>No letters or words to move.</>
            )}
            {hereHoldings.staked > 0 && (
              <> {plural(hereHoldings.staked, "staked word stays", "staked words stay")} here: unstake to move {hereHoldings.staked === 1 ? "it" : "them"}.</>
            )}
          </p>
          {hereHoldings.word > 0 && (
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={includeWord} onChange={(e) => setIncludeWord(e.target.checked)} />
              <span>
                Also move my {hereHoldings.word.toLocaleString("en-US")} $WORD. It pays for spelling, rolling, and waking your words, so the
                wallet you play with needs it.
              </span>
            </label>
          )}
          <p className="mt-1.5 text-xs text-ink/60">
            {process.env.NEXT_PUBLIC_PAYMASTER_ENABLED === "1"
              ? `With Coinbase Wallet the move is free: the game pays the network fee. Other wallets need a little ETH on ${NETWORK.name}.`
              : `This wallet sends the move, so it needs a little ETH on ${NETWORK.name} for the network fee.`}{" "}
            Open swap offers from this wallet stop working. The game can’t undo a move.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="teal"
              disabled={!dest || busy !== null || (hereHoldings.letters + hereHoldings.words === 0 && !includeWord)}
              onClick={() => void doMove()}
            >
              {dest ? `Move to ${short(dest)}` : "Pick a wallet"}
            </Button>
            <button onClick={() => setMoving(false)} className="text-xs font-bold text-ink/45 underline">
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.chainBacked && others.length > 0 && (
        <div className="mt-3 rounded-xl border-2 border-ink/15 p-3 text-sm">
          <div className="font-bold text-ink">Care for staked words from any wallet</div>
          <p className="mt-1 text-xs text-ink/65">
            Only this wallet can wake the words it stakes, unless you name your other wallets as caretakers. A caretaker can
            wake, roll, and ascend them, paying from its own wallet. Only this wallet can unstake them.
          </p>
          <div className="mt-2 space-y-1.5">
            {others.map((w) => {
              const on = caretakersQ.data?.[w] ?? false;
              return (
                <div key={w} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs">
                    {short(w)}
                    {on && <span className="ml-1.5 font-sans font-bold text-teal-ink">Caretaker</span>}
                  </span>
                  <button
                    disabled={busy !== null || !caretakersQ.data}
                    onClick={() => void setCaretaker(w, !on)}
                    className={`shrink-0 text-xs font-bold underline ${on ? "text-ink/45" : "text-teal-ink"}`}
                  >
                    {on ? "Stop" : "Let it care for them"}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {madeHere && pending ? (
        <div className="mt-2 rounded-xl border-2 border-dashed border-ink/25 p-3 text-sm text-ink/75">
          <div className="font-bold text-ink">Now sign with the other wallet</div>
          <ul className="mt-1 list-disc space-y-1 pl-4">
            {!inHost && <li>On this device: switch to it in your wallet app, or with Switch wallet below. This card then asks it to sign.</li>}
            <li>On another device, or in Farcaster: open the link there with that wallet connected.</li>
          </ul>
          <div className="mt-2 flex flex-wrap gap-2">
            {!inHost && (
              // RainbowKit offers no account modal on a network it doesn't know: then disconnect, and
              // the game's connect panel takes the other wallet.
              <Button size="sm" variant="ghost" onClick={() => (openAccountModal ?? openConnectModal ?? (() => disconnect()))()}>
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
              Linked wallets share one bag, one profile, and one set of free letters, and the links are public. Letters and
              words stay in the wallet that holds them: you play with the connected one, or move them into it.
            </p>
          </div>
        )
      )}
      {viaFarcaster.size > 0 && (
        <p className="mt-2 text-[11px] leading-snug text-ink/55">
          Wallets your Farcaster account verified join on their own. To take one out, remove its verification in Farcaster.
        </p>
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
