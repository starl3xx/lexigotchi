import { Rig } from "@/components/characters/Rig";
import { Wordmark } from "@/components/brand/Wordmark";
import { WORD_COUNT } from "@/lib/dictionary";
import { TOTAL_SUPPLY_CAP, LEGENDARIES, TIER_COUNTS } from "@/lib/economy";

const LOOP = [
  ["Mint", "Pull lowercase letters — daily single (1/day) or packs of 5. Odds mirror the dictionary."],
  ["Raise", "Roll lowercase → UPPERCASE. 45% base, pity to 85%. Capitals are raised, never pulled."],
  ["Claim", "Spell a dictionary word, escrow its 5 letters → a permanent, unique Word NFT."],
  ["Stake & Snack", "Stake to earn. UPPERCASE words draw yield; any staked word is a jackpot ticket. Feed them or they get hungry."],
  ["Win", "Lexigotchi picks a secret word each day — the jackpot draw. Hold it, staked & fed → you win the pot."],
];

export default function Home() {
  return (
    <div className="space-y-12">
      <section className="space-y-5">
        <Wordmark size={1.1} />
        <h1 className="font-display text-3xl font-extrabold leading-tight md:text-4xl">
          Raise your letters. Spell your words. Own the dictionary.
        </h1>
        <p className="max-w-2xl text-lg text-ink/80">
          A tamagotchi-style collection game for the <strong>$WORD</strong> /{" "}
          <em>Let&apos;s Have A Word!</em> ecosystem on Base. Mint rubber-hose letter
          characters, gamble them from lowercase to UPPERCASE, claim words from the
          canonical dictionary, and stake them for $WORD — with a daily jackpot that fires
          when your staked word is the day&apos;s answer.
        </p>
        <div className="flex flex-wrap items-end gap-6 pt-2">
          <Rig letter="A" state="idle" variant="lower" size={140} />
          <Rig letter="S" state="celebrate" variant="lower" size={140} />
          <Rig letter="Q" state="idle" variant="upper" earning size={150} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          [WORD_COUNT.toLocaleString(), "claimable words"],
          [TOTAL_SUPPLY_CAP.toLocaleString(), "letter supply cap"],
          [LEGENDARIES.length.toString(), "Legendaries"],
          ["~12 yrs", "to draw every word"],
        ].map(([big, small]) => (
          <div key={small} className="cel rounded-lg bg-paper p-4">
            <div className="font-display text-2xl font-extrabold">{big}</div>
            <div className="text-sm text-ink/70">{small}</div>
          </div>
        ))}
      </section>

      <section className="space-y-4">
        <h2 className="font-display text-2xl font-extrabold">The loop</h2>
        <ol className="space-y-3">
          {LOOP.map(([title, body], i) => (
            <li key={title} className="cel flex gap-4 rounded-lg bg-paper p-4">
              <span className="font-display text-2xl font-extrabold text-candy">{i + 1}</span>
              <div>
                <div className="font-display text-lg font-bold">{title}</div>
                <div className="text-sm text-ink/80">{body}</div>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-3">
        <h2 className="font-display text-2xl font-extrabold">The grails</h2>
        <p className="text-sm text-ink/70">
          {TIER_COUNTS.Legendary} Legendaries, rarest first. <strong>JAZZY</strong> is the
          apex — the only word combining two distinct ultra-rares with a double.
        </p>
        <div className="flex flex-wrap gap-1.5">
          {LEGENDARIES.map((w) => (
            <span key={w} className="tile px-2 py-1 font-display text-sm font-bold">
              {w}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}
