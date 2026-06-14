"use client";
/**
 * Lexigotchi — the playable prototype. A portrait Farcaster-mini-app shell (phone frame on
 * desktop, full-bleed on mobile) wrapping every game screen, driven by the mock state store.
 * No contracts are wired; every action mutates local state so the full loop is explorable.
 */
import { GameProvider, useGame, fmtWord, fmtUsd, type View } from "./state";
import { Toaster } from "./primitives";
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
import { Backpack, DotsThree, Fire, House, IconContext, SkipForward, Sparkle, Trophy } from "./ui/icons";

export function GameApp() {
  return (
    <GameProvider>
      <Frame />
    </GameProvider>
  );
}

function Frame() {
  const { state } = useGame();
  return (
    <IconContext.Provider value={{ weight: "bold", size: 18 }}>
      <div className="fixed inset-0 z-50 flex justify-center bg-ink/95 sm:items-center sm:p-4">
        <div className="relative flex h-full w-full max-w-[430px] flex-col overflow-hidden bg-paper sm:h-[880px] sm:max-h-full sm:rounded-[2.4rem] sm:border-[6px] sm:border-ink sm:shadow-[0_12px_0_#000]">
          {/* faint aged-paper grain to match the marketing site */}
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{ backgroundImage: "radial-gradient(#e7d7b0 0.5px, transparent 0.5px)", backgroundSize: "14px 14px" }}
          />
          <TopBar />
          <main className="relative flex-1 overflow-y-auto px-4 pb-28 pt-3">
            <Screen view={state.view} />
          </main>
          <BottomNav />
          <Toaster />
          <SheetHost />
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
  if (state.sheet?.kind === "word") return <WordSheet id={state.sheet.id} />;
  if (state.sheet?.kind === "pack") return <PackReveal letters={state.sheet.letters} />;
  if (state.sheet?.kind === "roll") return <RollSheet target={state.sheet.target} />;
  if (state.sheet?.kind === "balance") return <BalanceSheet />;
  return null;
}

// ---------------------------------------------------------------------------
// Top bar — brand + balance + streak + day control
// ---------------------------------------------------------------------------

function TopBar() {
  const { state, skipDay, openSheet } = useGame();
  return (
    <header className="relative z-10 flex items-center justify-between border-b-[3px] border-ink bg-paper-dark/70 px-4 py-2.5">
      <div className="flex items-center gap-2">
        <span className="font-display text-lg font-extrabold tracking-tight">LEXIGOTCHI</span>
        <span className="inline-flex items-center gap-0.5 rounded-full border-2 border-ink bg-candy px-1.5 py-0.5 text-[10px] font-bold text-paper">
          <Fire weight="fill" size={12} /> {state.streak}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => openSheet({ kind: "balance" })}
          title="Your $WORD — view balance & buy more"
          aria-label="Your $WORD balance — open wallet"
          className="rounded-full border-2 border-ink bg-paper px-2.5 py-1 text-right leading-none transition-all active:translate-y-[1px]"
        >
          <div className="font-display text-sm font-extrabold">{fmtWord(state.balance)}</div>
          <div className="text-[9px] text-ink/60">{fmtUsd(state.balance)} · $WORD</div>
        </button>
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
