/**
 * The landing page at `/` — the front door for players who arrive from the open web.
 *
 * A server component with NO wallet code: wagmi, RainbowKit and the Neynar provider mount only on
 * `/play`. The page links there; it never connects anything itself, so a visitor who only reads
 * pays nothing for the game's wallet stack.
 *
 * Every number is derived (dictionary, economy, params), never typed. The art is the game's own
 * TileCharacter, so the page and the game can't drift apart visually either.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { WORD_COUNT } from "@/lib/dictionary";
import { LEGENDARIES, LETTERS_BY_FREQUENCY } from "@/lib/economy";
import { DEFAULT_PARAMS } from "@/lib/params";
import { HOW_IT_WORKS, pct } from "@/lib/howItWorks";
import { isChainBacked, isRealEconomy } from "@/lib/onchain/gameMode";
import { NETWORK } from "@/lib/onchain/network";
import { VERIFY_URL } from "@/lib/onchain/verifications";
import { TileCharacter, TileWord } from "@/components/game/TileCharacter";
import { WordStripLive } from "@/components/WordStrip";
import {
  ArrowRight,
  Confetti,
  Cookie,
  DiceFive,
  SealCheck,
  Sparkle,
  Trophy,
  Wallet,
  XLogo,
} from "@/components/game/ui/icons";

const WORD_TOKEN = "0x304e649e69979298bd1aee63e175adf07885fb4b"; // $WORD on Base (the LHAW token)
const LINKS = {
  word: `https://basescan.org/token/${WORD_TOKEN}`,
  lhaw: "https://letshaveaword.fun",
  docs: "/docs", // the player docs (Mintlify, proxied by vercel.json)
  source: "https://github.com/starl3xx/lexigotchi",
  x: "https://x.com/lexigotchi",
  starl3xx: "https://starl3xx.fun",
};

const RAREST_WORD = LEGENDARIES[0];
const days = (n: number) => (n === 1 ? "a day" : `${n} days`);
const fraction = (x: number) => (x === 0.5 ? "half its yield" : `${pct(x)} of its yield`);
/** The four rarest letters to pull, rarest first (pull odds = share of dictionary slots). */
const GRAILS = LETTERS_BY_FREQUENCY.slice(-4).reverse();

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const BTN =
  "inline-flex select-none items-center justify-center gap-2 rounded-xl border-[3px] border-ink font-display font-extrabold " +
  // The game's shared hover-lift and press (globals.css, .press), so the site and the game click alike.
  "press shadow-[3px_3px_0_#1b1714] [--sh:3px] " +
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-candy";

function PlayButton({ size = "md", tone = "candy" }: { size?: "md" | "lg"; tone?: "candy" | "gold" }) {
  const pad = size === "lg" ? "px-6 py-3.5 text-lg" : "px-4 py-2 text-sm";
  const color = tone === "gold" ? "bg-gold text-ink" : "bg-candy text-paper";
  return (
    <Link href="/play" className={`${BTN} ${pad} ${color}`}>
      Play now
      <ArrowRight weight="bold" size={size === "lg" ? 20 : 16} aria-hidden />
    </Link>
  );
}

function Wordmark({ small = false }: { small?: boolean }) {
  return (
    // The first letter IS a tile: a separate tile beside the full name read as "I LEXIGOTCHI".
    <span className="inline-flex items-center gap-0.5" aria-label="Lexigotchi" role="img">
      <TileCharacter char="l" upper detail="tile" size={small ? 26 : 32} />
      <span aria-hidden className={`font-display font-black tracking-tight ${small ? "text-base" : "text-xl"}`}>
        EXIGOTCHI
      </span>
    </span>
  );
}

function SectionHead({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
  return (
    <div className="max-w-2xl">
      <p className="text-sm font-bold uppercase tracking-[0.14em] text-candy">{kicker}</p>
      <h2 className="mt-2 font-display text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">{title}</h2>
      {children && <p className="mt-4 text-lg leading-relaxed text-ink/70">{children}</p>}
    </div>
  );
}

/**
 * The hero stage: a vaudeville proscenium (curtain valance, spotlight, wooden floor) with the
 * rarest word in the dictionary mid-raise, two letters already UPPERCASE. Two renders at two sizes
 * rather than a CSS scale: TileWord lays out in pixels, and a transform would not shrink its box.
 */
function Stage() {
  const upper = [true, true, false, false, false];
  return (
    <div className="relative overflow-hidden rounded-[28px] border-[3px] border-ink bg-night shadow-[8px_8px_0_#1b1714]">
      <div aria-hidden className="absolute inset-x-0 top-0 h-6 bg-curtain" />
      <div
        aria-hidden
        className="absolute inset-x-0 top-6 h-5"
        style={{
          background:
            "radial-gradient(circle at 50% 0, #7b1e26 0 13px, #1b1714 13px 16px, transparent 16.5px) 0 0 / 36px 20px repeat-x",
        }}
      />
      <div
        aria-hidden
        className="absolute inset-0"
        style={{ background: "radial-gradient(ellipse 55% 75% at 50% 25%, rgba(252,232,168,0.30), transparent 72%)" }}
      />
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-16 border-t-[3px] border-ink bg-edgeWood" />
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-16 opacity-25"
        style={{ background: "repeating-linear-gradient(90deg, transparent 0 46px, #1b1714 46px 48px)" }}
      />

      <div className="relative flex min-h-[240px] items-end justify-center px-4 pb-9 pt-16 sm:min-h-[400px]">
        <TileWord word={RAREST_WORD} upper={upper} detail="full" size={58} className="sm:hidden" />
        <TileWord word={RAREST_WORD} upper={upper} detail="full" size={96} className="hidden sm:flex lg:hidden xl:flex" />
        <TileWord word={RAREST_WORD} upper={upper} detail="full" size={78} className="hidden lg:flex xl:hidden" />
      </div>

      <p className="absolute left-1/2 top-12 -translate-x-1/2 whitespace-nowrap rounded-full border-2 border-ink bg-gold px-3 py-1 text-xs font-extrabold uppercase tracking-wider text-ink shadow-[2px_2px_0_#1b1714] sm:top-14 sm:text-sm">
        The rarest crown: {RAREST_WORD}
      </p>
    </div>
  );
}

const STEP_VISUALS: ReactNode[] = [
  <div key="collect" className="flex items-end justify-center gap-1">
    {[..."word"].map((c, i) => (
      <TileCharacter key={i} char={c} detail="full" state="idle" size={50} />
    ))}
  </div>,
  <TileWord key="create" word="CRANE" upper={[false, false, false, false, false]} detail="full" size={42} />,
  <div key="roll" className="flex items-center justify-center gap-2">
    <TileCharacter char="r" detail="full" state="idle" size={50} />
    <DiceFive weight="fill" size={28} className="shrink-0 text-candy" aria-hidden />
    <TileCharacter char="r" upper detail="full" state="upgrade" size={68} />
  </div>,
  <div key="win" className="relative flex items-center justify-center">
    <Confetti weight="fill" size={112} className="absolute text-candy/30" aria-hidden />
    <Trophy weight="fill" size={78} className="relative text-gold-deep" aria-hidden />
    <span className="absolute -left-4 bottom-0 flex h-9 w-9 items-center justify-center rounded-full border-[3px] border-ink bg-paper text-candy shadow-[2px_2px_0_#1b1714]">
      <Cookie weight="fill" size={18} aria-hidden />
    </span>
    <Sparkle weight="fill" size={20} className="absolute -right-2 -top-2 text-gold" aria-hidden />
  </div>,
];

function Stat({ figure, children }: { figure: ReactNode; children: ReactNode }) {
  return (
    <div className="cel rounded-2xl bg-tileFace p-5">
      <div className="flex min-h-[44px] items-center font-display text-4xl font-black tracking-tight">{figure}</div>
      <p className="mt-2 text-sm leading-snug text-ink/70">{children}</p>
    </div>
  );
}

function Door({
  icon,
  name,
  tag,
  iconBg = "bg-tileFace",
  children,
}: {
  icon: ReactNode;
  iconBg?: string;
  name: string;
  tag: "Needed" | "Optional";
  children: ReactNode;
}) {
  return (
    <div className="cel flex flex-col rounded-2xl bg-paper p-6">
      <div className="flex items-center justify-between">
        <span className={`flex h-12 w-12 items-center justify-center rounded-xl border-[3px] border-ink ${iconBg}`}>{icon}</span>
        <span
          className={`rounded-full border-2 border-ink px-2.5 py-0.5 text-xs font-extrabold uppercase tracking-wider ${
            tag === "Needed" ? "bg-candy text-paper" : "bg-paper text-ink/60"
          }`}
        >
          {tag}
        </span>
      </div>
      <h3 className="mt-5 font-display text-xl font-extrabold">{name}</h3>
      <p className="mt-2 leading-relaxed text-ink/70">{children}</p>
    </div>
  );
}

function Qa({ q, children }: { q: string; children: ReactNode }) {
  return (
    <details className="group cel rounded-2xl bg-paper px-6 py-5 [&_summary::-webkit-details-marker]:hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-display text-lg font-extrabold transition-colors hover:text-candy-ink">
        {q}
        <span
          aria-hidden
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 border-ink text-xl leading-none transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-open:rotate-45"
        >
          +
        </span>
      </summary>
      <div className="mt-3 leading-relaxed text-ink/75">{children}</div>
    </details>
  );
}

const A = ({ href, children }: { href: string; children: ReactNode }) => (
  <a href={href} target="_blank" rel="noopener noreferrer" className="font-semibold underline decoration-2 underline-offset-2 hover:text-candy">
    {children}
  </a>
);

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/**
 * `xOn`: X linking is switched on (`xEnabled()`, read by the server page). It adds X as a door to the
 * free daily letter, so the page never offers an account the game can't link yet. `emailOn`: email
 * reminders are switched on (`emailEnabled()`), so "no email" becomes "email optional".
 */
export function LandingPage({ xOn = false, emailOn = false }: { xOn?: boolean; emailOn?: boolean }) {
  const practice = !isRealEconomy();
  // The chain game on a test network (Base Sepolia), as opposed to the in-browser practice game.
  const testnet = isChainBacked() && NETWORK.isTestnet;
  const { baseSuccess, pityCap } = DEFAULT_PARAMS.roll;
  const care = DEFAULT_PARAMS.care;

  return (
    <div className="overflow-x-clip">
      {/* Header */}
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5 sm:px-8">
        <Link href="/">
          <Wordmark />
        </Link>
        <nav className="flex items-center gap-6 text-sm font-bold">
          <a href="#how-it-works" className="hidden hover:text-candy md:inline">
            How it works
          </a>
          <a href="#jackpot" className="hidden hover:text-candy md:inline">
            Jackpot
          </a>
          <a href="#faq" className="hidden hover:text-candy md:inline">
            FAQ
          </a>
          <a href={LINKS.docs} className="hidden hover:text-candy md:inline">
            Docs
          </a>
          <PlayButton />
        </nav>
      </header>

      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-8 sm:px-8 lg:grid-cols-[1.15fr_1fr] lg:pt-14">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border-2 border-ink bg-tileFace px-3 py-1 text-sm font-bold">
            <span className="h-2 w-2 rounded-full bg-teal" aria-hidden />A letter-collecting game on Base
          </p>
          <h1 className="mt-6 font-display text-[40px] font-black leading-[0.98] tracking-tight sm:text-6xl lg:text-5xl xl:text-[60px]">
            Raise your letters.
            <br />
            Spell your words.
            <br />
            <span className="text-candy">Own the dictionary.</span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink/75 sm:text-xl">
            Every letter is a little character you collect, roll up to UPPERCASE, and keep fed. Spell one of{" "}
            {WORD_COUNT.toLocaleString("en-US")} five-letter words and it’s yours alone.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-4">
            <PlayButton size="lg" />
            <a href="#how-it-works" className={`${BTN} bg-paper px-6 py-3.5 text-lg text-ink`}>
              How it works
            </a>
          </div>
          <p className="mt-6 text-sm text-ink/60">Any wallet works. It also plays inside Farcaster and the Base App.</p>
          {practice && (
            <p className="mt-2 text-sm text-ink/60">
              <span className="mr-1.5 rounded border-2 border-ink/70 px-1.5 py-px text-[11px] font-extrabold uppercase tracking-wider text-ink/70">
                {testnet ? "Testnet" : "Preview"}
              </span>
              {testnet
                ? "The game runs on Base Sepolia with test $WORD until the contracts launch on Base."
                : "Balances are for practice until the contracts launch on Base."}
            </p>
          )}
        </div>
        <Stage />
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-6 border-y-[3px] border-ink bg-paper-dark/60">
        <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
          <SectionHead kicker="How it works" title="From one letter to the jackpot." />
          <ol className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {HOW_IT_WORKS.map((s, i) => (
              <li key={s.n} className="cel flex flex-col rounded-2xl bg-paper p-6">
                <div className="flex h-[132px] items-center justify-center">{STEP_VISUALS[i]}</div>
                <div className="mt-5 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-candy text-sm font-extrabold text-paper">
                    {s.n}
                  </span>
                  <h3 className="font-display text-xl font-extrabold">{s.title}</h3>
                </div>
                <p className="mt-3 leading-relaxed text-ink/70">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Numbers */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          <Stat figure={WORD_COUNT.toLocaleString("en-US")}>words in the dictionary, and each one has a single owner</Stat>
          <Stat figure={LEGENDARIES.length}>Legendary crowns, the rarest words to spell</Stat>
          <Stat
            figure={
              <span className="flex gap-1.5">
                {GRAILS.map((c) => (
                  <TileCharacter key={c} char={c} detail="tile" size={40} />
                ))}
              </span>
            }
          >
            the grails, the rarest letters to pull from a pack
          </Stat>
          <Stat figure={`${pct(baseSuccess)} → ${pct(pityCap)}`}>roll odds, rising after every miss until a letter turns UPPERCASE</Stat>
        </div>
      </section>

      {/* Jackpot */}
      <section id="jackpot" className="scroll-mt-6 border-y-[3px] border-ink bg-night text-paper">
        <div className="mx-auto grid max-w-6xl items-center gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <p className="text-sm font-bold uppercase tracking-[0.14em] text-gold">The daily jackpot</p>
            <h2 className="mt-2 font-display text-4xl font-black leading-[1.05] tracking-tight sm:text-5xl">One word wins every day.</h2>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-paper/80">
              Each day the game reveals a secret word from a sequence locked in onchain before launch, so nobody can
              steer it, not even the team. If a player holds that word, staked and fed, they take the whole pot. If
              nobody does, the pot rolls over and grows.
            </p>
            <div className="mt-8 max-w-xl rounded-2xl border-[3px] border-paper/80 p-6">
              <h3 className="font-display text-xl font-extrabold">The weekly bounty</h3>
              <p className="mt-2 leading-relaxed text-paper/80">
                Each week has a theme, like words with a double letter or words that end in -ING. Everyone holding a
                staked, fed match shares the pool, and rarer words take a bigger share.
              </p>
            </div>
          </div>
          <div className="relative flex min-h-[300px] items-center justify-center">
            <div
              aria-hidden
              className="absolute h-[300px] w-[300px] rounded-full"
              style={{ background: "radial-gradient(circle, rgba(240,166,23,0.35), transparent 68%)" }}
            />
            <TileCharacter char="w" upper gild={4} state="celebrate" detail="full" size={190} />
          </div>
        </div>
      </section>

      {/* Wallets */}
      <section className="mx-auto max-w-6xl px-5 py-20 sm:px-8">
        <SectionHead kicker="Start playing" title="Bring any wallet.">
          {emailOn
            ? "No sign-up. Your wallet is your Lexigotchi account, and your letters and words live in it. An email is optional, for reminders."
            : "No sign-up and no email. Your wallet is your Lexigotchi account, and your letters and words live in it."}
        </SectionHead>
        <div className={`mt-12 grid gap-6 ${xOn ? "md:grid-cols-2 lg:grid-cols-4" : "md:grid-cols-3"}`}>
          <Door icon={<Wallet weight="fill" size={24} aria-hidden />} name="Your wallet" tag="Needed">
            MetaMask, Rabby, Phantom, Coinbase Wallet, or any browser wallet.
          </Door>
          <Door
            icon={
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/fc-arch-icon.png" alt="" width={24} height={24} />
            }
            name="Farcaster"
            tag="Optional"
            iconBg="bg-[#855DCD]"
          >
            Link it to unlock one free letter a day. Inside Farcaster, the game connects on its own.
          </Door>
          {xOn && (
            <Door icon={<XLogo weight="bold" size={22} className="text-paper" aria-hidden />} name="X" tag="Optional" iconBg="bg-ink">
              Link an X account older than 90 days for the same free daily letter. It shows publicly next to your wallet.
            </Door>
          )}
          <Door icon={<SealCheck weight="fill" size={24} className="text-[#0052ff]" aria-hidden />} name="Coinbase verification" tag="Optional">
            {xOn ? "No Farcaster or X? " : "No Farcaster? "}A <A href={VERIFY_URL}>Coinbase-verified</A> wallet unlocks the same
            free daily letter.
          </Door>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-6 border-t-[3px] border-ink bg-paper-dark/60">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-8 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <SectionHead kicker="FAQ" title="Good questions." />
            <p className="mt-4 text-ink/70">
              <A href={`${LINKS.docs}/faq`}>Read every answer in the docs</A>
            </p>
          </div>
          <div className="space-y-4">
            <Qa q="Do I need a Farcaster account?">
              {xOn
                ? "No. Your wallet is your account. Linking Farcaster is optional. The free daily letter needs Farcaster, X, or a Coinbase-verified wallet."
                : "No. Your wallet is your account. Linking Farcaster is optional, and it unlocks the free daily letter."}
            </Qa>
            <Qa q="What is $WORD?">
              <A href={LINKS.word}>$WORD</A> is the token on Base behind Lexigotchi and{" "}
              <A href={LINKS.lhaw}>Let’s Have A Word!</A> It pays for packs, rolls, words, and snacks, and it funds the
              daily jackpot.
            </Qa>
            <Qa q="Can a roll cost me my letter?">
              Never. A failed roll leaves your letter exactly as it was, and your odds on that letter go up for the next
              try.
            </Qa>
            <Qa q="Is the jackpot fair?">
              Rolls use a commit and reveal, and every daily word comes from a sequence committed onchain before launch.
              Nobody can change a future answer.
            </Qa>
            <Qa q="What happens if I stop feeding a word?">
              After {days(care.peckishAfterDays)} unfed it gets peckish and earns {fraction(care.peckishYieldFactor)}.
              After {days(care.hungryAfterDays)} it’s hungry: it earns nothing and can’t win the jackpot until you feed
              it.
            </Qa>
          </div>
        </div>
      </section>

      {/* Closing call */}
      <section className="border-t-[3px] border-ink bg-candy text-paper">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-8 px-5 py-20 text-center sm:px-8">
          <TileWord word="HELLO" upper={[true, true, true, true, true]} state="celebrate" detail="full" size={64} className="sm:hidden" />
          <TileWord word="HELLO" upper={[true, true, true, true, true]} state="celebrate" detail="full" size={96} className="hidden sm:flex" />
          <h2 className="font-display text-4xl font-black tracking-tight sm:text-5xl">Your letters are waiting.</h2>
          <PlayButton size="lg" tone="gold" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t-[3px] border-ink">
        <div className="border-b-2 border-ink/10 px-5 py-3">
          <WordStripLive />
        </div>
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-8">
          <div className="flex items-center gap-3">
            <Wordmark small />
            <span className="text-ink/60">
              Made by <A href={LINKS.starl3xx}>starl3xx</A>
            </span>
          </div>
          <nav className="flex flex-wrap gap-x-6 gap-y-2 font-semibold text-ink/70">
            <Link href="/play" className="hover:text-candy">
              Play
            </Link>
            <a href={LINKS.word} target="_blank" rel="noopener noreferrer" className="hover:text-candy">
              $WORD on Base
            </a>
            <a href={LINKS.lhaw} target="_blank" rel="noopener noreferrer" className="hover:text-candy">
              Let’s Have A Word!
            </a>
            <a href={LINKS.x} target="_blank" rel="noopener noreferrer" className="hover:text-candy">
              @lexigotchi on X
            </a>
            <a href={LINKS.source} target="_blank" rel="noopener noreferrer" className="hover:text-candy">
              Source
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
