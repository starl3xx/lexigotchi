"use client";
/**
 * Lexigotchi — the game shell around every screen, on whichever store backs it (practice or chain).
 *
 * Responsive by WIDTH only, never by environment (useViewer reads "loading" first, which would flash
 * the wrong layout and can mismatch at hydration):
 *   - below md (768px): the portrait app — top bar, one column, bottom tab bar. Phones, and every
 *     mini-app host (Farcaster's web client renders mini apps at ~424px), always land here.
 *   - md and up: a desktop page — a side rail with every destination, a header with the page title,
 *     and screens that widen into grids (lg: two columns). No phone frame.
 * Overlays (sheets, onboarding, toasts) hang off the OUTER container so on desktop they cover the
 * whole window, not just the content column.
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
import { ChainGameProvider } from "./ChainGameProvider";
import { isChainBacked } from "@/lib/onchain/gameMode";
import { HomeScreen } from "./screens/HomeScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { BagScreen } from "./screens/BagScreen";
import { MintScreen } from "./screens/MintScreen";
import { ClaimScreen } from "./screens/ClaimScreen";
import { JackpotScreen } from "./screens/JackpotScreen";
import { BountyScreen } from "./screens/BountyScreen";
import { DictionaryScreen } from "./screens/DictionaryScreen";
import { LeaderboardScreen } from "./screens/LeaderboardScreen";
import { LhawScreen } from "./screens/LhawScreen";
import { ShowcaseScreen } from "./screens/ShowcaseScreen";
import { SwapScreen } from "./screens/SwapScreen";
import { WordSheet } from "./sheets/WordSheet";
import { PackReveal } from "./sheets/PackReveal";
import { RollSheet } from "./sheets/RollSheet";
import { BalanceSheet } from "./sheets/BalanceSheet";
import { FaqSheet } from "./sheets/FaqSheet";
import { CheatSheet } from "./sheets/CheatSheet";
import { AddAppSheet } from "./sheets/AddAppSheet";
import { CelebrateSheet } from "./sheets/CelebrateSheet";
import { AddAppHost } from "./AddAppHost";
import {
  ArrowsLeftRight, Backpack, BookOpen, DotsThree, Fire, House, IconContext, MaskHappy, Medal, Planet, Question, Ranking,
  SkipForward, Smiley, Sparkle, TextAa, Trophy,
} from "./ui/icons";
import { useWordPrice } from "@/lib/oracle/useWordPrice";
import { WordStripLive } from "@/components/WordStrip";

// Bump the version suffix whenever the onboarding flow materially changes, so players who already
// dismissed an older version see the new one once (v2 added the "Roll to upgrade" step).
const ONBOARDED_KEY = "lexigotchi:onboarded:v2";

export function GameApp() {
  // Live $WORD peg — mounted HERE, above every screen, so the re-render on oracle arrival repaints
  // all USD numbers at once (a lower mount could show two peg readings side by side).
  useWordPrice();
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
  // The Neynar MiniAppProvider calls sdk.actions.ready() once the SDK loads, dismissing the
  // Farcaster splash screen — no manual call needed here.
  return (
    <IconContext.Provider value={{ weight: "bold", size: 18 }}>
      {/* The outer box is the overlay host: fixed to the viewport, so the sheets, onboarding and
          toasts below (absolute inset-0) cover the whole window on desktop, rail included. */}
      <div className="fixed inset-0 z-50 flex bg-paper">
        <SideRail />
        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          {/* faint aged-paper grain */}
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ backgroundImage: "radial-gradient(#e7d7b0 0.5px, transparent 0.5px)", backgroundSize: "14px 14px" }}
          />
          <TopBar />
          <main className="relative flex-1 overflow-y-auto px-4 pb-28 pt-3 md:px-8 md:pb-12 md:pt-6">
            {/* Phones: the full width (as before). Desktop: a readable column the screens fill
                with their own grids. Tablets in portrait get a centered phone-width column. */}
            <div className="mx-auto w-full max-w-[560px] md:max-w-5xl">
              {/* Keyed by view so navigating away from a crashed screen clears the error — otherwise
                  one bad screen holds its error state across every later navigation. */}
              <ScreenErrorBoundary key={state.view}>
                {PUBLIC_VIEWS.has(state.view) && state.status === "no-wallet" ? (
                  <Screen view={state.view} />
                ) : (
                  <ChainGate>
                    <Screen view={state.view} />
                  </ChainGate>
                )}
              </ScreenErrorBoundary>
              {/* The $WORD line at the foot of every screen: contract, link, market cap. */}
              <WordStripLive className="mt-10" />
            </div>
          </main>
          <BottomNav />
        </div>
        <Toaster />
        <SheetHost />
        <AddAppHost />
        {/* Sign In With Farcaster for web players. Listens for the event useViewer().signIn()
            fires — no hidden button to synthetically click, which mobile popup blockers defeated. */}
        <WebSignInHost />
        {!onboarded && <Onboarding onDone={onFinishOnboarding} />}
      </div>
    </IconContext.Provider>
  );
}

function Screen({ view }: { view: View }) {
  switch (view) {
    case "home": return <HomeScreen />;
    case "more": return <MoreScreen />;
    case "bag": return <BagScreen />;
    case "mint": return <MintScreen />;
    case "claim": return <ClaimScreen />;
    case "jackpot": return <JackpotScreen />;
    case "bounty": return <BountyScreen />;
    case "dictionary": return <DictionaryScreen />;
    case "leaderboard": return <LeaderboardScreen />;
    case "lhaw": return <LhawScreen />;
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
  if (state.sheet?.kind === "cheatsheet") return <CheatSheet />;
  if (state.sheet?.kind === "addapp") return <AddAppSheet />;
  if (state.sheet?.kind === "celebrate") return <CelebrateSheet word={state.sheet.word} />;
  return null;
}

// ---------------------------------------------------------------------------
// Top bar — brand + balance + streak + day control
// ---------------------------------------------------------------------------

function TopBar() {
  const { state, skipDay, openSheet } = useGame();
  const helpBtn = (
    <button
      onClick={() => openSheet({ kind: "cheatsheet" })}
      title="Cheat sheet: how to play"
      aria-label="Open the cheat sheet"
      className="hit-44 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-paper active:translate-y-[1px]"
    >
      <Question weight="bold" size={15} />
    </button>
  );
  return (
    <header className="relative z-10 flex items-center justify-between border-b-[3px] border-ink bg-paper-dark/70 px-4 py-2.5 md:px-8 md:py-3">
      <div className="flex items-center gap-1.5">
        <span className="font-display text-base font-extrabold tracking-tight md:hidden">LEXIGOTCHI</span>
        {/* Desktop: the rail shows the brand, so the header names the page instead. */}
        <h1 className="hidden font-display text-xl font-extrabold tracking-tight md:block">{VIEW_TITLE[state.view]}</h1>
        {/* Hidden on the chain store: there is no on-chain streak yet, and a hardcoded 0 in a
            flame chip reads as a real streak the player just lost. Absent beats wrong. */}
        {!state.chainBacked && (
          <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-ink bg-candy-deep px-1.5 py-0.5 text-[10px] font-bold text-paper">
            <Fire weight="fill" size={12} /> {state.streak}
          </span>
        )}
      </div>
      {/* gap-3.5 keeps the 44 px tap areas (hit-44) from overlapping; under 380 px the practice
          game's six header items need the old gap to fit, and the areas overlap by a few px. */}
      <div className="flex items-center gap-2 min-[380px]:gap-3.5">
        <button
          onClick={() => openSheet({ kind: "balance" })}
          title="Your $WORD: view your balance and buy more"
          aria-label="Your $WORD balance: open your wallet"
          className="rounded-full border-2 border-ink bg-paper px-2.5 py-1 text-right tabular-nums leading-none transition-transform active:translate-y-[1px]"
        >
          {/* An unknown balance renders as "—", never as 0: a player who sees 0 concludes they
              are broke (or robbed), and every affordability affordance downstream agrees with it. */}
          <div className="font-display text-sm font-extrabold">
            {state.status === "ready" ? fmtWord(state.balance) : "–"}
          </div>
          <div className="whitespace-nowrap text-[9px] text-ink/60">
            {state.status === "ready" ? `${fmtUsd(state.balance)} · $WORD` : "$WORD"}
          </div>
        </button>
        {helpBtn}
        {/* Practice game only: onchain, time moves on its own (and the chain store's skipDay is a no-op). */}
        {!state.chainBacked && (
        <button
          onClick={skipDay}
          title="Skip a day (prototype): advances hunger and draws a new daily word"
          className="hit-44 flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-paper active:translate-y-[1px]"
          aria-label="Skip a day"
        >
          <SkipForward weight="fill" size={14} />
        </button>
        )}
        {/* The profile sits at the far right, where players look for their account. */}
        <ViewerChip />
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
      className="hit-44 shrink-0 transition-transform active:translate-y-[1px]"
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
// Side rail (md and up) — every destination at once, where the phone needs a "More" page
// ---------------------------------------------------------------------------

/**
 * Screens that show public information and need no wallet, plus More, the directory that reaches
 * them on a phone. With NO wallet, ChainGate would cover them with the connect panel, and a visitor
 * deciding whether to play should be able to read them. Only that case skips the gate: while a
 * connected wallet's bag is loading, or the chain read failed, the gate still shows its skeleton or
 * error, so the Dictionary never says "you own 0" before the bag arrives (Bugbot on #121).
 */
const PUBLIC_VIEWS: ReadonlySet<View> = new Set<View>(["dictionary", "leaderboard", "lhaw", "more"]);

/** The page title the desktop header shows. */
const VIEW_TITLE: Record<View, string> = {
  home: "Today",
  bag: "Your bag",
  mint: "Mint letters",
  claim: "Spell a word",
  jackpot: "Daily jackpot",
  bounty: "Weekly bounty",
  dictionary: "Dictionary",
  leaderboard: "Leaderboard",
  lhaw: "Let’s Have A Word!",
  showcase: "Showcase",
  swap: "Swap letters",
  more: "More",
};

const RAIL: { heading: string; items: { view: View; label: string; Icon: typeof House }[] }[] = [
  {
    heading: "Play",
    items: [
      { view: "home", label: "Today", Icon: House },
      { view: "bag", label: "Bag", Icon: Backpack },
      { view: "mint", label: "Mint", Icon: Sparkle },
      { view: "claim", label: "Spell", Icon: TextAa },
    ],
  },
  {
    heading: "Win",
    items: [
      { view: "jackpot", label: "Jackpot", Icon: Trophy },
      { view: "bounty", label: "Bounty", Icon: Medal },
      { view: "leaderboard", label: "Leaderboard", Icon: Ranking },
    ],
  },
  {
    heading: "Collect",
    items: [
      { view: "dictionary", label: "Dictionary", Icon: BookOpen },
      { view: "showcase", label: "Showcase", Icon: MaskHappy },
      { view: "swap", label: "Swap", Icon: ArrowsLeftRight },
    ],
  },
  {
    heading: "$WORD universe",
    items: [{ view: "lhaw", label: "Let’s Have A Word!", Icon: Planet }],
  },
];

function SideRail() {
  const { state, nav, openSheet } = useGame();
  const item = (view: View, label: string, Icon: typeof House) => {
    const active = state.view === view;
    return (
      <button
        key={view}
        onClick={() => nav(view)}
        aria-current={active ? "page" : undefined}
        className={`flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold transition-colors ${
          active ? "bg-ink text-paper" : "text-ink/75 hover:bg-ink/[0.06] hover:text-ink"
        }`}
      >
        <Icon size={20} weight={active ? "fill" : "regular"} />
        {label}
      </button>
    );
  };
  return (
    <aside className="relative z-10 hidden h-full w-56 shrink-0 flex-col border-r-[3px] border-ink bg-paper-dark/70 md:flex lg:w-60">
      {/* the brand goes home to the landing page */}
      <a href="/" className="flex items-center gap-2 px-5 pb-4 pt-4 font-display text-lg font-extrabold tracking-tight">
        LEXIGOTCHI
      </a>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Game">
        {RAIL.map((group) => (
          <div key={group.heading}>
            <div className="px-3 pb-1.5 text-xs font-bold text-ink/50">{group.heading}</div>
            <div className="space-y-1">{group.items.map((i) => item(i.view, i.label, i.Icon))}</div>
          </div>
        ))}
      </nav>
      <div className="space-y-1 border-t-2 border-ink/15 px-3 py-3">
        {item("more", "More", DotsThree)}
        <button
          onClick={() => openSheet({ kind: "cheatsheet" })}
          className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-ink/75 transition-colors hover:bg-ink/[0.06] hover:text-ink"
        >
          <Question size={20} weight="regular" /> Cheat sheet
        </button>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Bottom nav (below md)
// ---------------------------------------------------------------------------

const TABS: { view: View; label: string; Icon: typeof House }[] = [
  { view: "home", label: "Today", Icon: House },
  { view: "bag", label: "Bag", Icon: Backpack },
  { view: "mint", label: "Mint", Icon: Sparkle },
  { view: "jackpot", label: "Win", Icon: Trophy },
];

const MORE: View[] = ["more", "claim", "bounty", "dictionary", "leaderboard", "lhaw", "showcase", "swap"];

function BottomNav() {
  const { state, nav } = useGame();
  const onMore = MORE.includes(state.view);
  return (
    <nav className="absolute inset-x-0 bottom-0 z-20 flex items-stretch justify-around border-t-[3px] border-ink bg-paper-dark/95 px-1 pb-[max(0.4rem,env(safe-area-inset-bottom))] pt-1.5 backdrop-blur md:hidden">
      {TABS.map((t) => (
        <NavBtn key={t.view} active={state.view === t.view} Icon={t.Icon} label={t.label} onClick={() => nav(t.view)} />
      ))}
      <NavBtn active={onMore} Icon={DotsThree} label="More" onClick={() => nav("more")} />
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
      className={`flex flex-1 flex-col items-center gap-0.5 rounded-xl py-1.5 text-xs font-bold transition-colors ${
        active ? "bg-ink text-paper" : "text-ink/70"
      }`}
    >
      <Icon size={22} weight={active ? "fill" : "regular"} />
      {label}
    </button>
  );
}
