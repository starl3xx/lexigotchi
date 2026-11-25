"use client";
/**
 * The back of a word's card (./SceneCard): the word's story, in its rarity's material. Approved in
 * the "Scene Cards" mock (starl3xx, 2026-11-25): deep backs (a rich material, cream type), a faint
 * card-stock texture, the tiles still on a rack in perspective, and the words on steady plates so
 * they read over any material. Labels semibold and as written (capitals mean a raised letter in
 * this game), the same size as their values; values regular.
 *
 * Every size has the same layout, trimmed by the card's width (globals.css, `.cb`, container
 * queries): a phone-sized back shows four stats; a bigger one all eight and the line along the
 * bottom. A Bag thumbnail passes `mini`: the rarity, the tiles on their rack, and one line, with no
 * reads at all.
 *
 * Still, always: no tile bounces or shines on the back (the material is drawn once, by CSS here;
 * a later step draws it live where a card is in focus).
 */
import { TileCharacter, type Gild } from "../game/TileCharacter";
import type { ReactNode } from "react";
import { fmtWord, useGame, type OwnedWord } from "../game/state";
import { DICTIONARY_SIZE, ascensionLabel } from "@/lib/cardFacts";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { addressOf } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { SCROLL_PATH_CARD, materialOf } from "./material";
import { useCardFacts } from "./useCardFacts";

const fmt = (n: number) => n.toLocaleString("en-US");
const MOOD: Record<string, string> = { fed: "full", peckish: "peckish", hungry: "hungry" };

export function CardBack({ word, mini = false }: { word: OwnedWord; mini?: boolean }) {
  const m = materialOf(word.tier);
  return (
    <div className={`cb m-${m}`}>
      <div className="cb-mat">
        <div className="cb-tex" />
        {m === "rare" && <div className="cb-brush" />}
        {m === "legendary" && <div className="cb-glitter" />}
        {m === "mythic" && <Facets />}
      </div>
      <div className="cb-frame" />
      {m === "mythic" && <div className="cb-fire" />}
      {m === "legendary" && !mini && (["tl", "tr", "bl", "br"] as const).map((k) => <Scroll key={k} corner={k} />)}
      {mini ? <MiniBody word={word} /> : <FullBody word={word} />}
    </div>
  );
}

function Rack({ word }: { word: OwnedWord }) {
  const gild = Math.max(0, Math.min(5, Math.round(word.prestigeLevel))) as Gild;
  return (
    <div className="cb-rackwrap">
      {/* a tile rack in perspective: its top runs back behind the tiles, its lip stands in front */}
      <svg className="cb-rack cb-rack-back" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden>
        <polygon points="5,4 95,4 100,13 0,13" className="rk-top" />
        <polygon points="5,4 95,4 95.6,5 4.4,5" className="rk-far" />
        <rect x="1.5" y="10.6" width="97" height="1.4" className="rk-groove" />
      </svg>
      <div className="cb-tiles">
        {[...word.word].map((ch, i) => (
          <div key={i} className="cb-tile">
            <TileCharacter char={ch} upper={word.upper[i] ?? false} gild={gild} detail="tile" fluid tier={word.tier} still />
          </div>
        ))}
      </div>
      <svg className="cb-rack cb-rack-front" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden>
        <path d="M0 13 L100 13 L100 18 Q100 20 98 20 L2 20 Q0 20 0 18 Z" className="rk-front" />
        <rect x="0" y="13" width="100" height="0.9" className="rk-lip" />
      </svg>
    </div>
  );
}

function TierPlate({ tier }: { tier: string }) {
  return (
    <span className="cb-tier cb-plate">
      <Gem />
      {tier}
    </span>
  );
}

/** A thumbnail's back (a Bag card): the rarity, the tiles, and one line. Reads nothing. */
function MiniBody({ word }: { word: OwnedWord }) {
  return (
    <div className="cb-body">
      <div className="cb-top">
        <TierPlate tier={word.tier} />
      </div>
      <div className="cb-main">
        <div className="cb-wordcol">
          <Rack word={word} />
          <p className="cb-mini cb-plate">1 of 1 · {ascensionLabel(word.prestigeLevel)}</p>
        </div>
      </div>
    </div>
  );
}

function FullBody({ word }: { word: OwnedWord }) {
  const f = useCardFacts(word);
  const { state } = useGame();
  const dash = "–";
  const found =
    f.found.kind === "you" ? "you" : f.found.kind === "other" ? (f.found.name ? `@${f.found.name}` : `${f.found.address.slice(0, 6)}…${f.found.address.slice(-4)}`) : dash;
  const jackpot =
    f.drawn === null ? null : f.drawn === "never" ? "Never drawn for the jackpot" : `Drawn for the jackpot (draw ${f.drawn})`;
  // The token on the explorer, in the chain game only (the practice game has no contracts).
  const tokenHref = state.chainBacked ? `${NETWORK.explorer}/nft/${addressOf("words")}/${tokenIdOf(word.word).toString()}` : null;
  return (
    <div className="cb-body">
      <div className="cb-top">
        <TierPlate tier={f.tier} />
        <span className="cb-no cb-plate">
          No. {fmt(f.number)} of {fmt(DICTIONARY_SIZE)}
        </span>
      </div>
      <div className="cb-main">
        <div className="cb-wordcol">
          <Rack word={word} />
          <div className="cb-oneof cb-plate">
            <b>1 of 1</b>
            <span>
              One of {fmt(f.ofTier)} {f.tier} words
            </span>
          </div>
        </div>
        <dl className="cb-stats cb-plate">
          <Stat label="Case">{f.caseLabel}</Stat>
          <Stat label="Ascension">
            {f.ascension} <Pips level={f.level} />
          </Stat>
          <Stat label="Yours since">{f.since ?? dash}</Stat>
          <Stat label="Staked">{f.staked ? `Yes, ${MOOD[f.mood]}` : "No"}</Stat>
          <Stat label="Earned so far" more>
            {f.earned === null ? dash : f.earned > 0 ? `${fmtWord(f.earned)} $WORD` : "None yet"}
          </Stat>
          <Stat label="Earns staked" more>
            {f.perDay === "upper" ? "Once UPPERCASE" : f.perDay === null ? dash : `~${fmtWord(f.perDay)} a day`}
          </Stat>
          <Stat label="Cost to make" more>
            {f.cost === null ? dash : `~${fmtWord(f.cost)} $WORD`}
          </Stat>
          <Stat label="Points" more>
            {f.points}
          </Stat>
        </dl>
      </div>
      <div className="cb-foot cb-plate">
        <span>
          Found by <b>{found}</b>
        </span>
        {jackpot && <span>{jackpot}</span>}
        {tokenHref ? (
          <a className="cb-id" href={tokenHref} target="_blank" rel="noreferrer" aria-label={`${word.word} on the block explorer`}>
            {f.token}
          </a>
        ) : (
          <span className="cb-id">{f.token}</span>
        )}
      </div>
    </div>
  );
}

function Stat({ label, more = false, children }: { label: string; more?: boolean; children: ReactNode }) {
  return (
    <div className={`cb-stat ${more ? "cb-more" : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Pips({ level }: { level: number }) {
  return (
    <span className="cb-pips" aria-hidden>
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= level ? (i === 5 ? "on holo" : "on") : ""} />
      ))}
    </span>
  );
}

export function Gem() {
  return (
    <svg className="cb-gem" viewBox="0 0 20 20" aria-hidden>
      <path d="M10 1 L18 6 L18 14 L10 19 L2 14 L2 6 Z" className="g1" />
      <path d="M10 1 L18 6 L10 9 L2 6 Z" className="g2" />
      <path d="M10 9 L18 6 L18 14 L10 19 Z" className="g3" />
    </svg>
  );
}

/** Gold's engraved scrollwork, in one corner of the back. */
function Scroll({ corner }: { corner: "tl" | "tr" | "bl" | "br" }) {
  return (
    <span className={`cb-corner ${corner}`}>
      <svg viewBox="0 0 40 40" aria-hidden>
        <path d={SCROLL_PATH_CARD} fill="none" className="sc1" strokeWidth="2.4" transform="translate(1 1)" strokeLinecap="round" />
        <path d={SCROLL_PATH_CARD} fill="none" className="sc2" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

/** The facets of a brilliant cut, seen from above (Mythic's back). */
function Facets() {
  const rays: string[] = [];
  for (let i = 0; i < 16; i++) {
    const a = (Math.PI * 2 * i) / 16;
    rays.push(`M 80 45 L ${(80 + Math.cos(a) * 120).toFixed(1)} ${(45 + Math.sin(a) * 120).toFixed(1)}`);
  }
  return (
    <svg className="cb-facets" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice" aria-hidden>
      <path d={rays.join(" ")} className="fl" strokeWidth="0.35" fill="none" />
      <path d="M 80 21 L 104 45 L 80 69 L 56 45 Z" className="ft" strokeWidth="0.4" />
    </svg>
  );
}
