"use client";
/**
 * Lexigotchi — the playable prototype. A portrait Farcaster-mini-app shell (phone frame on
 * desktop, full-bleed on mobile) wrapping every game screen, driven by the mock state store.
 * No contracts are wired; every action mutates local state so the full loop is explorable.
 */
import { useCallback, useEffect, useState } from "react";
import { PRELAUNCH } from "@/lib/site";
import { GameProvider, useGame, fmtWord, fmtUsd, type View } from "./state";
import { useViewer } from "./useViewer";
import { Onboarding, OnboardingContext } from "./Onboarding";
import { PreLaunchScreen } from "./screens/PreLaunchScreen";
import { markOnboardedServer } from "./campaignClient";
import { Toaster } from "./primitives";
import { ScreenErrorBoundary, ChainGate } from "./ChainGate";
import { WebSignInHost } from "./WebSignInHost";
import { useConnect } from "wagmi";
import { ChainGameProvider } from "./ChainGameProvider";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";

/**
 * Which store backs the game.
 *
 * Chain-backed only when the suite actually has addresses on this network AND we're on a testnet —
 * mainnet stays on the mock until the remaining signer routes exist, because a half-wired real
 * economy is worse than an honest simulation. NEXT_PUBLIC_CHAIN_GAME=0 forces the mock back on for
 * side-by-side comparison.
 */
function isChainBacked(): boolean {
  if (process.env.NEXT_PUBLIC_CHAIN_GAME === "0") return false;
  return isSuiteDeployed() && NETWORK.isTestnet;
}
import { HomeScreen } from "./screens/HomeScreen";
import { BagScreen } from "./screens/BagScreen";
import { MintScreen } from "./screens/MintScreen";
import { ClaimScreen } from "./screens/ClaimScreen";
import { JackpotScreen } from "./screens/JackpotScreen";
import { BountyScreen } from "./screens/BountyScreen";
import { LexidexScreen } from "./screens/LexidexScreen";
import { ShowcaseScreen } from "./screens/ShowcaseScreen";
import { SwapScreen } from "./screens/SwapScreen";
import { WordSheet } from "./sheets/WordSheet";
import { PackReveal } from "./sheets/PackReveal";
import { RollSheet } from "./sheets/RollSheet";
import { BalanceSheet } from "./sheets/BalanceSheet";
import { FaqSheet } from "./sheets/FaqSheet";
import { AddAppSheet } from "./sheets/AddAppSheet";
import { AddAppHost } from "./AddAppHost";
import { Backpack, DotsThree, Fire, House, IconContext, Question, SkipForward, Smiley, Sparkle, Trophy } from "./ui/icons";

// Bump the version suffix whenever the onboarding flow materially changes, so players who already
// dismissed an older version see the new one once (v2 added the "Roll to upgrade" step).
const ONBOARDED_KEY = "lexigotchi:onboarded:v2";

export function GameApp() {
  // Pre-launch campaign: short-circuit the whole game and run the "add the app + share a cast →
  // free pack at launch" splash. Lives here (under <Providers> from play/page.tsx) so the Farcaster
  // SDK hooks still work, but above <GameProvider> so none of the game store/screens mount.
  if (PRELAUNCH) return <PreLaunchScreen />;
  const Provider = isChainBacked() ? ChainGameProvider : GameProvider;
  return (
    <Provider>
      <OnboardingHost />
    </Provider>
  );
}

/** Owns the once-only onboarding flag (persisted in localStorage) and exposes a replay action. */
function OnboardingHost() {
  const { closeSheet } = useGame();
  // Default true so SSR/first paint matches (no overlay → no hydration mismatch); the effect flips
  // it to false for first-run players right after mount.
  const [onboarded, setOnboarded] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(ONBOARDED_KEY) !== "1") setOnboarded(false);
    } catch {
      /* storage unavailable — just skip onboarding */
    }
  }, []);
  const finish = useCallback(() => {
    try {
      localStorage.setItem(ONBOARDED_KEY, "1");
    } catch {
      /* ignore */
    }
    closeSheet(); // never reveal a sheet that was left open under the overlay
    setOnboarded(true);
    void markOnboardedServer(); // persist "onboarded" server-side (no-op outside a Farcaster client)
  }, [closeSheet]);
  const replay = useCallback(() => {
    try {
      localStorage.removeItem(ONBOARDED_KEY);
    } catch {
      /* ignore */
    }
    closeSheet(); // start the intro from a clean slate, with no sheet underneath
    setOnboarded(false);
  }, [closeSheet]);

  return (
    <OnboardingContext.Provider value={{ replay }}>
      <Frame onboarded={onboarded} onFinishOnboarding={finish} />
    </OnboardingContext.Provider>
  );
}

function Frame({ onboarded, onFinishOnboarding }: { onboarded: boolean; onFinishOnboarding: () => void }) {
  const { state } = useGame();
  // wagmi is mounted by <Providers> for both stores, so this is safe on the mock path too (where
  // status is always "ready" and ChainGate never renders the connect prompt).
  const { connect, connectors } = useConnect();
  const connectWallet = useCallback(() => {
    // connectors[0] is the Farcaster mini-app connector, which AUTO-connects inside a Farcaster
    // host — so if this button is visible we are on the web, and picking [0] leaves an extension
    // user unable to connect at all. Prefer the injected connector here and fall back only if it
    // is absent.
    const injected =
      connectors.find((c) => c.type === "injected" || c.id === "injected") ?? connectors[0];
    if (injected) connect({ connector: injected });
  }, [connect, connectors]);
  // The Neynar MiniAppProvider calls sdk.actions.ready() once the SDK loads, dismissing the
  // Farcaster splash screen — no manual call needed here.
  return (
    <IconContext.Provider value={{ weight: "bold", size: 18 }}>
      <div className="fixed inset-0 z-50 flex justify-center bg-ink/95 sm:items-center sm:p-4">
        <div className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-paper sm:h-[880px] sm:max-h-full sm:rounded-[2.4rem] sm:border-[6px] sm:border-ink sm:shadow-[0_12px_0_#000]">
          {/* faint aged-paper grain */}
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ backgroundImage: "radial-gradient(#e7d7b0 0.5px, transparent 0.5px)", backgroundSize: "14px 14px" }}
          />
          <TopBar />
          <main className="relative flex-1 overflow-y-auto px-4 pb-28 pt-3">
            {/* Keyed by view so navigating away from a crashed screen clears the error — otherwise
                one bad screen holds its error state across every later navigation. */}
            <ScreenErrorBoundary key={state.view}>
              <ChainGate connect={connectWallet}>
                <Screen view={state.view} />
              </ChainGate>
            </ScreenErrorBoundary>
          </main>
          <BottomNav />
          <Toaster />
          <SheetHost />
          <AddAppHost />
          {/* Sign In With Farcaster for web players. Listens for the event useViewer().signIn()
              fires — no hidden button to synthetically click, which mobile popup blockers defeated. */}
          <WebSignInHost />
          {!onboarded && <Onboarding onDone={onFinishOnboarding} />}
        </div>
      </div>
    </IconContext.Provider>
  );
}

function Screen({ view }: { view: View }) {
  switch (view) {
    case "home": return <HomeScreen />;
    case "bag": return <BagScreen />;
    case "mint": return <MintScreen />;
    case "claim": return <ClaimScreen />;
    case "jackpot": return <JackpotScreen />;
    case "bounty": return <BountyScreen />;
    case "lexidex": return <LexidexScreen />;
    case "showcase": return <ShowcaseScreen />;
    case "swap": return <SwapScreen />;
    default: return <HomeScreen />;
  }
}

function SheetHost() {
  const { state } = useGame();
  if (state.sheet?.kind === "word") return <WordSheet word={state.sheet.word} />;
  if (state.sheet?.kind === "pack") return <PackReveal letters={state.sheet.letters} />;
  if (state.sheet?.kind === "roll") return <RollSheet target={state.sheet.target} />;
  if (state.sheet?.kind === "balance") return <BalanceSheet />;
  if (state.sheet?.kind === "faq") return <FaqSheet />;
  if (state.sheet?.kind === "addapp") return <AddAppSheet />;
  return null;
}

// ---------------------------------------------------------------------------
// Top bar — brand + balance + streak + day control
// ---------------------------------------------------------------------------

function TopBar() {
  const { state, skipDay, openSheet } = useGame();
  const helpBtn = (
    <button
      onClick={() => openSheet({ kind: "faq" })}
      title="How Lexigotchi works — FAQ"
      aria-label="Open the FAQ"
      className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-paper active:translate-y-[1px]"
    >
      <Question weight="bold" size={15} />
    </button>
  );
  return (
    <header className="relative z-10 flex items-center justify-between border-b-[3px] border-ink bg-paper-dark/70 px-4 py-2.5">
      <div className="flex items-center gap-1.5">
        <ViewerChip />
        <span className="font-display text-base font-extrabold tracking-tight">LEXIGOTCHI</span>
        {/* Hidden on the chain store: there is no on-chain streak yet, and a hardcoded 0 in a
            flame chip reads as a real streak the player just lost. Absent beats wrong. */}
        {!state.chainBacked && (
          <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-ink bg-candy px-1.5 py-0.5 text-[10px] font-bold text-paper">
            <Fire weight="fill" size={12} /> {state.streak}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => openSheet({ kind: "balance" })}
          title="Your $WORD — view balance & buy more"
          aria-label="Your $WORD balance — open wallet"
          className="rounded-full border-2 border-ink bg-paper px-2.5 py-1 text-right leading-none transition-all active:translate-y-[1px]"
        >
          {/* An unknown balance renders as "—", never as 0: a player who sees 0 concludes they
              are broke (or robbed), and every affordability affordance downstream agrees with it. */}
          <div className="font-display text-sm font-extrabold">
            {state.status === "ready" ? fmtWord(state.balance) : "—"}
          </div>
          <div className="text-[9px] text-ink/60">
            {state.status === "ready" ? `${fmtUsd(state.balance)} · $WORD` : "$WORD"}
          </div>
        </button>
        {helpBtn}
        <button
          onClick={skipDay}
          title="Skip a day (prototype) — advances hunger + draws a new daily word"
          className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-paper active:translate-y-[1px]"
          aria-label="Skip a day"
        >
          <SkipForward weight="fill" size={14} />
        </button>
      </div>
    </header>
  );
}

/** The player's Farcaster avatar (or a sign-in prompt on web). Opens the wallet/profile sheet. */
function ViewerChip() {
  const v = useViewer();
  const { openSheet } = useGame();
  if (v.environment === "loading") {
    return <span className="h-7 w-7 animate-pulse rounded-full border-2 border-ink bg-paper-dark" />;
  }
  return (
    <button
      onClick={() => openSheet({ kind: "balance" })}
      title={v.isAuthed ? `@${v.username}` : "Sign in"}
      aria-label={v.isAuthed ? `Signed in as ${v.username}` : "Sign in & wallet"}
      className="shrink-0 transition-transform active:translate-y-[1px]"
    >
      {v.pfpUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={v.pfpUrl} alt="" className="h-7 w-7 rounded-full border-2 border-ink object-cover" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-ink bg-paper text-ink/60">
          <Smiley weight="fill" size={15} />
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Bottom nav
// ---------------------------------------------------------------------------

const TABS: { view: View; label: string; Icon: typeof House }[] = [
  { view: "home", label: "Today", Icon: House },
  { view: "bag", label: "Bag", Icon: Backpack },
  { view: "mint", label: "Mint", Icon: Sparkle },
  { view: "jackpot", label: "Win", Icon: Trophy },
];

const MORE: View[] = ["claim", "bounty", "lexidex", "showcase", "swap"];

function BottomNav() {
  const { state, nav } = useGame();
  const onMore = MORE.includes(state.view);
  return (
    <nav className="absolute inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t-[3px] border-ink bg-paper-dark/95 px-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur">
      {TABS.map((t) => (
        <NavBtn key={t.view} active={state.view === t.view} Icon={t.Icon} label={t.label} onClick={() => nav(t.view)} />
      ))}
      <NavBtn active={onMore} Icon={DotsThree} label="More" onClick={() => nav("claim")} />
    </nav>
  );
}

function NavBtn({
  active,
  Icon,
  label,
  onClick,
}: {
  active: boolean;
  Icon: typeof House;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-[11px] font-bold transition-colors ${
        active ? "bg-candy text-paper" : "text-ink/70"
      }`}
    >
      <Icon size={22} weight={active ? "fill" : "regular"} />
      {label}
    </button>
  );
}
