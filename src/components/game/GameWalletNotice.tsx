"use client";
/**
 * Where the player's things are, said only when it matters (lib/profile/gameWalletAdvice.ts): choose
 * a game wallet, move things to it, switch to it, or gather what other wallets still hold. Shown at
 * the top of Today and the Bag. Silent for a player with one wallet, or when everything is where
 * they play. The × hides it on both screens until it names a wallet it didn't before
 * (useHiddenWalletNotices, `adviceKeys`): the profile's Wallets card keeps every wallet's holdings and Move.
 */
import { useAccount } from "wagmi";
import { Button, Card } from "./primitives";
import { Wallet, X } from "./ui/icons";
import { useGame } from "./state";
import { useViewer } from "./useViewer";
import { useProfile } from "./useProfile";
import { useWalletHoldings } from "./useWalletHoldings";
import { promptAccountSwitch } from "./walletSwitch";
import { hideWalletNotice, useHiddenWalletNotices } from "./useHiddenWalletNotices";
import { adviceKeys, gameWalletAdvice, holdingsText, noticeHidden } from "@/lib/profile/gameWalletAdvice";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function GameWalletNotice() {
  const { state, openSheet, toast } = useGame();
  const { address } = useAccount();
  const viewer = useViewer();
  const p = useProfile();
  const { wallets, holdings, gameWallet } = useWalletHoldings();
  const hidden = useHiddenWalletNotices();
  if (!state.chainBacked) return null;
  const inHost = viewer.environment === "farcaster";
  // Stakers that named this wallet a caretaker: their staked words are cared for from here.
  const caretakerOf = new Set(state.words.filter((w) => w.care && w.holder).map((w) => w.holder!.toLowerCase()));
  const advice = gameWalletAdvice({ connected: address ?? null, gameWallet, wallets, holdings, inHost, caretakerOf });
  if (advice.kind === "none") return null;
  const keys = adviceKeys(advice, address ?? null, wallets);
  if (noticeHidden(hidden, keys)) return null;
  const hide = () => {
    hideWalletNotice(keys);
    toast("Hidden. Your wallets stay in your profile.", "info");
  };

  const makeThisGame = async () => {
    if (!address) return;
    const r = await p.setGameWallet(address);
    if (r.error) toast(r.error === "no_session" ? "Sign in with your wallet first" : "Couldn’t save that. Try again.", "bad");
    else toast("This is your game wallet now", "good");
  };

  let title: string;
  let body: React.ReactNode;
  let actions: React.ReactNode = null;
  switch (advice.kind) {
    case "choose":
      title = "Choose your game wallet";
      body = (
        <>
          Your letters, words, and $WORD are onchain, spread across your wallets, and you can only play with the connected
          wallet’s own. Pick one wallet to keep everything in.
        </>
      );
      actions = (
        <Button size="sm" variant="teal" onClick={() => openSheet({ kind: "profile" })}>
          Choose a wallet
        </Button>
      );
      break;
    case "move_to_game":
      title = "This isn’t your game wallet";
      body = (
        <>
          This wallet ({short(advice.from)}) holds {holdingsText(advice.holdings)}. Your game wallet is {short(advice.to)}.
          Move them there, or make this your game wallet.
        </>
      );
      actions = (
        <>
          <Button size="sm" variant="teal" onClick={() => openSheet({ kind: "profile", focus: "move" })}>
            Move them
          </Button>
          <Button size="sm" variant="ghost" disabled={p.busy} onClick={() => void makeThisGame()}>
            Make this my game wallet
          </Button>
        </>
      );
      break;
    case "switch_to_game":
      title = "Your things are in your game wallet";
      body = advice.inHost ? (
        <>
          Your game wallet ({short(advice.game)}) holds {holdingsText(advice.holdings)}, but inside Farcaster you can only use
          this wallet. To play here, make this your game wallet, then move everything here from the web.
        </>
      ) : (
        <>
          Your game wallet ({short(advice.game)}) holds {holdingsText(advice.holdings)}. Switch to it to play.
        </>
      );
      actions = advice.inHost ? (
        <Button size="sm" variant="teal" disabled={p.busy} onClick={() => void makeThisGame()}>
          Make this my game wallet
        </Button>
      ) : (
        <Button size="sm" variant="teal" onClick={() => void promptAccountSwitch()}>
          Switch wallet
        </Button>
      );
      break;
    case "gather": {
      const staked = advice.elsewhere.some((e) => e.holdings.staked > 0);
      title = "Some of your things are in other wallets";
      body = (
        <>
          <ul className="mb-1 space-y-0.5">
            {advice.elsewhere.map((e) => (
              <li key={e.wallet}>
                <span className="font-mono text-xs">{short(e.wallet)}</span>: {holdingsText(e.holdings)}
              </li>
            ))}
          </ul>
          To play with them here, open Lexigotchi {advice.inHost ? "on the web " : ""}with each wallet and move them to this
          one, your game wallet.
          {staked && (
            <>
              {" "}
              Staked words stay with the wallet that staked them. Wake them from there, or, in that wallet’s profile, let this
              one care for them.
            </>
          )}
        </>
      );
      break;
    }
  }

  return (
    <Card className="border-gold bg-gold/10 text-sm lg:col-span-2">
      <div className="mb-1 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5 font-display font-extrabold">
          <Wallet weight="bold" className="shrink-0" /> {title}
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label="Hide this notice"
          title="Hide"
          className="hit-44 round-btn -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-card"
        >
          <X weight="bold" size={16} />
        </button>
      </div>
      <div className="text-ink/70">{body}</div>
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );
}
