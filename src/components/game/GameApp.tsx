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
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PRELAUNCH, DOCS_URL, X_HANDLE, X_URL } from "@/lib/site";
import { GameProvider, useGame, fmtWord, fmtUsd, showsUsd, type Sheet, type View } from "./state";
import { useViewer } from "./useViewer";
import { useOpenUrl } from "./useShare";
import { Onboarding, OnboardingContext } from "./Onboarding";
import { PreLaunchScreen } from "./screens/PreLaunchScreen";
import { markOnboardedServer, postFarcasterWalletsSync } from "./campaignClient";
import { forgetVerifiedWallets } from "./useVerifiedWallet";
import { SHEET_EXIT_MS, SheetClosing, Toaster, TweenNumber } from "./primitives";
import { Lockup } from "../brand/Lockup";
import { ScreenErrorBoundary, ChainGate } from "./ChainGate";
import { WebSignInHost } from "./WebSignInHost";
import { ChainGameProvider } from "./ChainGameProvider";
import { isChainBacked } from "@/lib/onchain/gameMode";
import { NETWORK } from "@/lib/onchain/network";
import { HomeScreen } from "./screens/HomeScreen";
import { MoreScreen } from "./screens/MoreScreen";
import { BagScreen } from "./screens/BagScreen";
import { MintScreen } from "./screens/MintScreen";
import { ClaimScreen } from "./screens/ClaimScreen";
import { JackpotScreen } from "./screens/JackpotScreen";
import { DictionaryScreen } from "./screens/DictionaryScreen";
import { LeaderboardScreen } from "./screens/LeaderboardScreen";
import { LhawScreen } from "./screens/LhawScreen";
import { WordScreen } from "./screens/WordScreen";
import { MarketScreen } from "./screens/MarketScreen";
import { WordSheet } from "./sheets/WordSheet";
import { MailSheet } from "./sheets/MailSheet";
import { useSoundGestures } from "./useSound";
import { RollSheet } from "./sheets/RollSheet";
import { AscendSheet } from "./sheets/AscendSheet";
import { BalanceSheet } from "./sheets/BalanceSheet";
import { ProfileSheet } from "./sheets/ProfileSheet";
import { bustPublicProfile, readPendingLink, resolveIdentity, useProfile, writePendingLink } from "./useProfile";
import { CheatSheet } from "./sheets/CheatSheet";
import { AddAppSheet } from "./sheets/AddAppSheet";
import { SceneSheet } from "./sheets/SceneSheet";
import { ShopScreen } from "./screens/ShopScreen";
import { shopEnabled } from "@/lib/shop/config";
import { EarningsSheet } from "./sheets/EarningsSheet";
import { LookupSheet } from "./sheets/LookupSheet";
import { ShopItemSheet } from "./sheets/ShopItemSheet";
import { useEarningsNote } from "./useEarningsNote";
import { useSceneSync } from "../scenes/useWordScene";
import { CelebrateSheet } from "./sheets/CelebrateSheet";
import { BoughtLettersSheet } from "./sheets/BoughtLettersSheet";
import { AddAppHost } from "./AddAppHost";
import { WalletNetworkNotice } from "./WalletNetworkNotice";
import {
  Backpack, BookBookmark, BookOpen, Coins, DotsThree, Fire, House, IconContext, Planet, Question, Ranking,
  SkipForward, Smiley, Sparkle, TextAa, Trophy, XLogo,
  Storefront, ShoppingBag,
} from "./ui/icons";
import { useWordPrice } from "@/lib/oracle/useWordPrice";
import { useWalletSighting } from "./useWalletSighting";
import { WordStripLive } from "@/components/WordStrip";
import { CollabLooksProvider } from "./collabLooks";

// Bump the version suffix whenever the onboarding flow materially changes, so players who already
// dismissed an older version see the new one once (v2 added the "Roll to upgrade" step).
const ONBOARDED_KEY = "lexigotchi:onboarded:v2";

export function GameApp() {
  // Live $WORD peg — mounted HERE, above every screen, so the re-render on oracle arrival repaints
  // all USD numbers at once (a lower mount could show two peg readings side by side).
  useWordPrice();
  // Counts this wallet in the operator console's Players tab, once a day (useWalletSighting).
  useWalletSighting();
  useSoundGestures(); // while sound is on, a tap wakes the browser's sound (lib/sound)
  // Pre-launch campaign: short-circuit the whole game and run the "add the app + share a cast →
  // free pack at launch" splash. Lives here (under <Providers> from play/page.tsx) so the Farcaster
  // SDK hooks still work, but above <GameProvider> so none of the game store/screens mount.
  if (PRELAUNCH) return <PreLaunchScreen />;
  const Provider = isChainBacked() ? ChainGameProvider : GameProvider;
  return (
    <CollabLooksProvider>
      <Provider>
        <SceneSync />
        <EarningsNote />
        <OnboardingHost />
      </Provider>
    </CollabLooksProvider>
  );
}

/** Owns the once-only onboarding flag (persisted in localStorage) and exposes a replay action. */
function OnboardingHost() {
  const { closeSheet, openSheet } = useGame();
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
    // …except the one a `?link=` URL came for: a first visit from "Link another wallet" lands on
    // the profile, where the Wallets card asks this wallet to sign.
    const link = readPendingLink();
    if (link && !link.madeBy) openSheet({ kind: "profile" });
  }, [closeSheet, openSheet]);
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
  // Decided once per screen, as it mounts: animate every screen but the first one shown.
  const lastView = useRef<View | null>(null);
  const viewAnim = useRef<{ view: View; animate: boolean } | null>(null);
  if (viewAnim.current?.view !== state.view) {
    viewAnim.current = { view: state.view, animate: lastView.current !== null };
  }
  lastView.current = state.view;
  const viewIn = viewAnim.current.animate;
  // A new screen starts at its top, not at the old screen's scroll position, unless the link named
  // a part of it (`nav(view, section)`: Today's bounty card, whose section a phone shows under the
  // jackpot). This runs after the screen's own effects, so nothing on mount can undo it. A section
  // already near the top (a wide screen's second column) leaves the page at its top, and one that
  // isn't rendered (the connect panel covers the screen) falls back to the top.
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    const target = state.section ? main.querySelector<HTMLElement>(`[data-section="${state.section}"]`) : null;
    const offset = target ? target.getBoundingClientRect().top - main.getBoundingClientRect().top + main.scrollTop : 0;
    const pad = parseFloat(getComputedStyle(main).paddingTop) || 0;
    main.scrollTo({ top: offset > main.clientHeight / 3 ? offset - pad : 0 });
  }, [state.view, state.section]);

  return (
    <IconContext.Provider value={{ weight: "bold", size: 18 }}>
      {/* The outer box is the overlay host: fixed to the viewport, so the sheets, onboarding and
          toasts below (absolute inset-0) cover the whole window on desktop, rail included. */}
      <div className="fixed inset-0 z-50 flex bg-paper">
        <SideRail still={!onboarded} />
        <div className="relative flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          {/* faint aged-paper grain */}
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ backgroundImage: "radial-gradient(#e7d7b0 0.5px, transparent 0.5px)", backgroundSize: "14px 14px" }}
          />
          <TopBar still={!onboarded} />
          <main ref={mainRef} className="relative flex-1 overflow-y-auto px-4 pb-28 pt-3 md:px-8 md:pb-12 md:pt-6">
            {/* Phones: the full width (as before). Desktop: a readable column the screens fill
                with their own grids. Tablets in portrait get a centered phone-width column. */}
            {/* A column at least as tall as the page, so the $WORD line sits at the bottom of a short
                screen and under the content of a long one (starl3xx, 2026-11-25). */}
            <div className="mx-auto flex min-h-full w-full max-w-[560px] flex-col md:max-w-5xl">
              {/* A wallet on a network this screen can't use: say so, with Switch and Disconnect
                  (the game's network, or Base on the $WORD page, whose swap is on Base mainnet). */}
              <WalletNetworkNotice />
              {/* Keyed by view so navigating away from a crashed screen clears the error — otherwise
                  one bad screen holds its error state across every later navigation. */}
              <ScreenErrorBoundary key={state.view}>
                {/* A screen you navigate to arrives in a short cascade (globals.css, .view-in);
                    the first screen on page load just appears. */}
                <div className={viewIn ? "view-in" : undefined}>
                  {PUBLIC_VIEWS.has(state.view) && state.status === "no-wallet" ? (
                    <Screen view={state.view} />
                  ) : (
                    <ChainGate>
                      <Screen view={state.view} />
                    </ChainGate>
                  )}
                </div>
              </ScreenErrorBoundary>
              {/* The $WORD line at the foot of every screen: contract, link, market cap. `mt-auto` takes
                  the spare height above it; the padding keeps it off the content when there is none. */}
              <WordStripLive className="mt-auto pt-10" />
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
        <XReturnHost />
        <LinkCodeHost />
        <FarcasterWalletsHost />
        {!onboarded && <Onboarding onDone={onFinishOnboarding} />}
      </div>
    </IconContext.Provider>
  );
}

/**
 * Back from X's consent page (/api/x/callback sends the web player to /play?x=linked|canceled|failed):
 * say how it went, reopen the profile, and drop the parameter so a reload doesn't say it again.
 */
/**
 * `?link=<code>`: a "Link another wallet" link opened here (another device, or a Farcaster host). Keep
 * the code for the profile's Wallets card, which asks the connected wallet to sign it.
 */
function LinkCodeHost() {
  const { openSheet } = useGame();
  useEffect(() => {
    const url = new URL(window.location.href);
    const code = url.searchParams.get("link");
    if (!code) return;
    url.searchParams.delete("link");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (!/^[0-9a-f]{24}$/.test(code)) return;
    writePendingLink({ code });
    openSheet({ kind: "profile" });
  }, [openSheet]);
  return null;
}

/**
 * Farcaster wallets join the profile (lib/profile/farcasterWallets.ts): once per page load for each
 * wallet and sign-in, ask the server to bring them in (or drop ones Farcaster no longer verifies),
 * and refresh every view of the account when it changed.
 */
function FarcasterWalletsHost() {
  const viewer = useViewer();
  const p = useProfile();
  const qc = useQueryClient();
  const asked = useRef(new Set<string>());
  const key = `${p.address ?? ""}|${viewer.fid ?? ""}|${p.sessionToken ? "s" : ""}`;
  useEffect(() => {
    if (!p.enabled || (!viewer.fid && !p.sessionToken) || asked.current.has(key)) return;
    asked.current.add(key);
    void postFarcasterWalletsSync(p.sessionToken).then((d) => {
      if (!d?.changed) return;
      bustPublicProfile();
      forgetVerifiedWallets();
      for (const k of ["profilePublic", "profileMe", "world", "dailyStatus", "ownedWords", "linkedLetters", "walletHoldings"]) {
        void qc.invalidateQueries({ queryKey: [k] });
      }
    });
  }, [key, p.enabled, p.sessionToken, viewer.fid, qc]);
  return null;
}

function XReturnHost() {
  const { toast, openSheet } = useGame();
  const qc = useQueryClient();
  useEffect(() => {
    const url = new URL(window.location.href);
    const x = url.searchParams.get("x");
    if (!x) return;
    url.searchParams.delete("x");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    if (x === "linked") {
      bustPublicProfile(); // the cached public view would show no X for a while
      void qc.invalidateQueries({ queryKey: ["profileMe"] });
      void qc.invalidateQueries({ queryKey: ["profilePublic"] });
      void qc.invalidateQueries({ queryKey: ["world"] });
      toast("X linked", "good");
    } else if (x === "held") {
      toast("Your current X account took today’s letter. You can change it tomorrow.", "info");
    } else if (x === "busy") {
      toast("That X account took today’s letter on another wallet. Link it here tomorrow.", "info");
    } else if (x === "canceled") {
      toast("X not linked: you canceled", "info");
    } else {
      toast("Couldn’t link X. Try again.", "bad");
    }
    openSheet({ kind: "profile" });
  }, [openSheet, qc, toast]);
  return null;
}

function Screen({ view }: { view: View }) {
  switch (view) {
    case "home": return <HomeScreen />;
    case "more": return <MoreScreen />;
    case "bag": return <BagScreen />;
    case "mint": return <MintScreen />;
    case "claim": return <ClaimScreen />;
    case "jackpot": return <JackpotScreen />;
    case "dictionary": return <DictionaryScreen />;
    case "leaderboard": return <LeaderboardScreen />;
    case "word": return <WordScreen />;
    case "lhaw": return <LhawScreen />;
    case "swap": return <MarketScreen />;
    case "shop": return <ShopScreen />;
    default: return <HomeScreen />;
  }
}

/**
 * The open sheet, and for SHEET_EXIT_MS after it closes, the sheet that just closed (marked
 * closing) so it can animate out instead of vanishing. Opening another sheet shows it at once.
 */
function SheetHost() {
  const { state } = useGame();
  const [last, setLast] = useState<Sheet>(state.sheet);
  const closing = !state.sheet && !!last;
  useEffect(() => {
    if (state.sheet) {
      setLast(state.sheet);
      return;
    }
    const id = window.setTimeout(() => setLast(null), SHEET_EXIT_MS);
    return () => window.clearTimeout(id);
  }, [state.sheet]);
  return (
    <SheetClosing.Provider value={closing}>
      <SheetFor sheet={state.sheet ?? last} />
    </SheetClosing.Provider>
  );
}

/** Uploads scene picks made before sign-in once a profile session exists (scenes/useWordScene). */
function EarningsNote() {
  useEarningsNote();
  return null;
}

function SceneSync() {
  useSceneSync();
  return null;
}

function SheetFor({ sheet }: { sheet: Sheet }) {
  const state = { sheet };
  if (state.sheet?.kind === "word") return <WordSheet word={state.sheet.word} />;
  if (state.sheet?.kind === "mail") return <MailSheet />;
  if (state.sheet?.kind === "roll") return <RollSheet target={state.sheet.target} />;
  if (state.sheet?.kind === "ascend") return <AscendSheet word={state.sheet.word} />;
  if (state.sheet?.kind === "balance") return <BalanceSheet />;
  if (state.sheet?.kind === "profile") return <ProfileSheet />;
  if (state.sheet?.kind === "cheatsheet") return <CheatSheet />;
  if (state.sheet?.kind === "addapp") return <AddAppSheet />;
  if (state.sheet?.kind === "celebrate") return <CelebrateSheet word={state.sheet.word} bought={state.sheet.bought} />;
  if (state.sheet?.kind === "boughtLetters") return <BoughtLettersSheet letterId={state.sheet.letterId} count={state.sheet.count} unitPrice={state.sheet.unitPrice} had={state.sheet.had} />;
  if (state.sheet?.kind === "scene") return <SceneSheet word={state.sheet.word} fromWord={state.sheet.fromWord} />;
  if (state.sheet?.kind === "earnings") return <EarningsSheet />;
  if (state.sheet?.kind === "lookup") return <LookupSheet word={state.sheet.word} />;
  if (state.sheet?.kind === "shopItem") return <ShopItemSheet id={state.sheet.id} word={state.sheet.word} />;
  return null;
}

// ---------------------------------------------------------------------------
// Top bar — brand + balance + streak + day control
// ---------------------------------------------------------------------------

/** `still`: the intro is up, and its own lockup is the living one (one living mark at a time). */
function TopBar({ still }: { still: boolean }) {
  const { state, skipDay, openSheet } = useGame();
  const helpBtn = (
    <button
      onClick={() => openSheet({ kind: "cheatsheet" })}
      title="Cheat sheet: how to play"
      aria-label="Open the cheat sheet"
      // Phones only: on desktop the rail's "Cheat sheet" is the same thing (starl3xx, 2026-11-24).
      className="hit-44 round-btn flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-card md:hidden"
    >
      <Question weight="bold" size={15} />
    </button>
  );
  return (
    <header className="relative z-10 flex items-center justify-between border-b-[3px] border-ink bg-paper-dark/70 px-4 py-2.5 md:px-8 md:py-3">
      <div className="flex items-center gap-1.5">
        {/* The lockup (components/brand/Lockup): on a phone the header has it, on a wide screen the rail
            does. It is 132 px wide at its full size, 41 more than the plain name was, and the row is
            tight on a phone: so it GIVES WAY, down to the old name's 91 px, before anything is pushed
            off the screen (at full size the profile button left a 390 px screen). Only the lockup
            gives way: letting this whole group shrink slid the chip beside it under the balance. */}
        <span className="min-w-[91px] shrink md:hidden">
          <Lockup alive={!still} height={28} className="h-auto w-full" />
        </span>
        {/* Desktop: the rail shows the brand, so the header names the page instead. */}
        <h1 className="hidden font-display text-xl font-extrabold tracking-tight md:block">{VIEW_TITLE[state.view]}</h1>
        {/* Hidden on the chain store: there is no on-chain streak yet, and a hardcoded 0 in a
            flame chip reads as a real streak the player just lost. Absent beats wrong. */}
        {!state.chainBacked && (
          <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-ink bg-candy-deep px-1.5 py-0.5 text-[10px] font-bold text-paper">
            <Fire weight="fill" size={12} /> {state.streak}
          </span>
        )}
        {/* The chain game on Base Sepolia: say so, so nobody takes test $WORD for the real token. */}
        {state.chainBacked && NETWORK.isTestnet && (
          <span
            className="whitespace-nowrap rounded-full border-2 border-ink bg-card px-1.5 py-0.5 text-[10px] font-bold text-ink/70"
            title="This game runs on Base Sepolia, a test network, with test $WORD."
          >
            Testnet
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
          className="round-btn rounded-full border-2 border-ink bg-card px-3.5 py-1.5 text-right tabular-nums leading-none"
        >
          {/* An unknown balance renders as "—", never as 0: a player who sees 0 concludes they
              are broke (or robbed), and every affordability affordance downstream agrees with it. */}
          <div className="font-display text-sm font-extrabold">
            {state.status === "ready" ? <TweenNumber value={state.balance} format={fmtWord} /> : "–"}
          </div>
          <div className="mt-0.5 whitespace-nowrap text-[9px] text-ink/60">
            {/* Test $WORD has no value, so the testnet game shows no dollar figure for it. */}
            {state.status !== "ready" ? "$WORD" : showsUsd(state) ? `${fmtUsd(state.balance)} · $WORD` : "test $WORD"}
          </div>
        </button>
        {helpBtn}
        {/* Practice game only: onchain, time moves on its own (and the chain store's skipDay is a no-op). */}
        {!state.chainBacked && (
        <button
          onClick={skipDay}
          title="Skip a day (practice): pays your earning words, advances hunger, and draws a new daily word"
          className="hit-44 round-btn flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-card"
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

/**
 * The player's picture (from the linked account they chose: useProfile's resolveIdentity), or a
 * smiley. Opens the Profile sheet; the balance pill beside it opens "Your $WORD".
 */
function ViewerChip() {
  const v = useViewer();
  const p = useProfile();
  const me = resolveIdentity(v, p.profile);
  const { openSheet } = useGame();
  if (v.environment === "loading") {
    return <span className="h-8 w-8 animate-pulse rounded-full border-2 border-ink bg-paper-dark" />;
  }
  return (
    <button
      onClick={() => openSheet({ kind: "profile" })}
      title={me.name ? `${me.name}: your profile` : "Your profile"}
      aria-label={me.name ? `Your profile, ${me.name}` : "Your profile and linked accounts"}
      className="hit-44 round-btn shrink-0 rounded-full"
    >
      {me.pfpUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={me.pfpUrl} alt="" className="h-8 w-8 rounded-full border-2 border-ink object-cover" />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-ink bg-card text-ink/60">
          <Smiley weight="fill" size={17} />
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
// The Shop is one of them: anyone can look at what it sells (its sheet opened with no wallet too).
const PUBLIC_VIEWS: ReadonlySet<View> = new Set<View>(["dictionary", "leaderboard", "word", "lhaw", "more", "shop"]);

/** The page title the desktop header shows. */
const VIEW_TITLE: Record<View, string> = {
  home: "Today",
  bag: "Your bag",
  mint: "Mint letters",
  claim: "Spell a word",
  jackpot: "Jackpot & bounty",
  dictionary: "Dictionary",
  leaderboard: "Leaderboard",
  word: "$WORD",
  lhaw: "Let’s Have A Word!",
  swap: "Market",
  shop: "Shop",
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
      { view: "leaderboard", label: "Leaderboard", Icon: Ranking },
    ],
  },
  {
    heading: "Collect",
    items: [
      { view: "dictionary", label: "Dictionary", Icon: BookOpen },
      { view: "swap", label: "Market", Icon: Storefront },
    ],
  },
  {
    heading: "$WORD universe",
    items: [
      { view: "word", label: "$WORD", Icon: Coins },
      { view: "lhaw", label: "Let’s Have A Word!", Icon: Planet },
    ],
  },
];

function SideRail({ still }: { still: boolean }) {
  const { state, nav, openSheet } = useGame();
  const openUrl = useOpenUrl();
  const item = (view: View, label: string, Icon: typeof House) => {
    const active = state.view === view;
    return (
      <button
        key={view}
        onClick={() => nav(view)}
        aria-current={active ? "page" : undefined}
        className={`group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 transition-[background-color,color,transform] duration-150 active:scale-[0.98] text-left text-sm font-bold ${
          active ? "bg-ink text-paper" : "text-ink/75 hover:bg-ink/[0.06] hover:text-ink"
        }`}
      >
        <Icon size={20} weight={active ? "fill" : "regular"} className="transition-transform duration-200 group-hover:translate-x-0.5" />
        {label}
      </button>
    );
  };
  return (
    <aside className="relative z-10 hidden h-full w-56 shrink-0 flex-col border-r-[3px] border-ink bg-paper-dark/70 md:flex lg:w-60">
      {/* the brand goes home to the landing page */}
      <a href="/" className="flex items-center px-5 pb-3 pt-3">
        <Lockup alive={!still} height={34} />
      </a>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="Game">
        {RAIL.map((group) => (
          <div key={group.heading}>
            <div className="px-3 pb-1.5 text-xs font-bold text-ink/50">{group.heading}</div>
            <div className="space-y-1">
              {group.items.map((i) => item(i.view, i.label, i.Icon))}
              {/* The Shop is a screen of its own (decisions.md #55), behind SHOP_ENABLED: no entry while
                  it's off, nor in the practice game, which has no chain. */}
              {group.heading === "Collect" && state.chainBacked && shopEnabled() && item("shop", "Shop", ShoppingBag)}
            </div>
          </div>
        ))}
      </nav>
      {/* No "More" here: the rail already lists every destination, so More (the phone's way to reach
          them) only repeated it (starl3xx, 2026-11-24). The game's X account takes its place. */}
      <div className="space-y-1 border-t-2 border-ink/15 px-3 py-3">
        <button
          onClick={() => openSheet({ kind: "cheatsheet" })}
          className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 transition-[background-color,color,transform] duration-150 active:scale-[0.98] text-left text-sm font-bold text-ink/75 hover:bg-ink/[0.06] hover:text-ink"
        >
          <Question size={20} weight="regular" className="transition-transform duration-200 group-hover:translate-x-0.5" /> Cheat sheet
        </button>
        <button
          onClick={() => void openUrl(X_URL)}
          className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-ink/75 transition-[background-color,color,transform] duration-150 hover:bg-ink/[0.06] hover:text-ink active:scale-[0.98]"
        >
          <XLogo size={20} weight="regular" className="transition-transform duration-200 group-hover:translate-x-0.5" /> @{X_HANDLE} on X ↗
        </button>
        <button
          onClick={() => void openUrl(DOCS_URL)}
          className="group flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-bold text-ink/75 transition-[background-color,color,transform] duration-150 hover:bg-ink/[0.06] hover:text-ink active:scale-[0.98]"
        >
          <BookBookmark size={20} weight="regular" className="transition-transform duration-200 group-hover:translate-x-0.5" /> Docs ↗
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

const MORE: View[] = ["more", "claim", "dictionary", "leaderboard", "word", "lhaw", "swap", "shop"];

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
