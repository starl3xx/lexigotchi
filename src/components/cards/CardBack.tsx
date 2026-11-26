"use client";
/**
 * The back of a word's card (./SceneCard): the word's story, in its rarity's material. Deep backs
 * (a rich material, cream type), a faint card-stock texture, and the tiles still on a rack in
 * perspective (the "Scene Cards" mock, starl3xx, 2026-11-25).
 *
 * Relettered with the card's front (decisions.md #35, the "Cards, Scenes, and Logo" proposal):
 * - **The card's number is the headline,** large, in the card's serif (Iowan Old Style where the
 *   device has it), with "One of one" under it.
 * - **The facts are a ledger:** a name, a row of dots, a value. Names in Söhne and as written
 *   (capitals mean a raised letter in this game; the owner: "back word casing can stay as it is"),
 *   values in the card's serif, so the two never blur.
 * - **The game's seal is pressed into the material** in one ink, behind the facts (lib/cardArt/seal;
 *   the owner: "I really like the Pressed, one ink version of the back").
 * - **The word itself is only ever its tiles** (in Söhne, on the rack): no line of text names it.
 * The words stand straight on the material now, with a soft shadow, not on plates.
 *
 * Every size has the same layout, trimmed by the card's width (globals.css, `.cb`, container
 * queries): a phone-sized back shows four stats; a bigger one all eight and the line along the
 * bottom. A Bag thumbnail passes `mini`: the rarity, the tiles on their rack, and one line, with no
 * reads at all.
 *
 * Still, always: no tile bounces or shines on the back (the material is drawn once, by CSS here;
 * a later step draws it live where a card is in focus).
 */
import { TileCharacter, useLowPower, usePrefersReducedMotion, type Gild } from "../game/TileCharacter";
import { TierMark } from "../game/TierMark";
import type { Tier } from "@/lib/economy";
import type { ReactNode } from "react";
import { fmtWord, useGame, type OwnedWord } from "../game/state";
import { ascensionLabel, cardDigits } from "@/lib/cardFacts";
import { svgDataUri, svgDoc } from "@/lib/cardArt/engrave";
import { SEAL, sealInk } from "@/lib/cardArt/seal";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { addressOf } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { SCROLL_PATH_CARD, materialOf } from "./material";
import { useCardFacts, type CardFacts } from "./useCardFacts";
import dynamic from "next/dynamic";
import { canDrawLive } from "./live/support";

// The live material loads the first time a back goes live: OGL stays out of the game's first download.
const LiveMaterial = dynamic(() => import("./live/LiveMaterial").then((m) => m.LiveMaterial), { ssr: false });

const fmt = (n: number) => n.toLocaleString("en-US");

/** Each material's line colour (globals.css `.m-*`, --cb-line): the seal is pressed in it. */
const SEAL_INK: Record<string, string> = { common: "#9a8164", uncommon: "#5cc4a9", rare: "#7fb0ef", legendary: "#e9b949", mythic: "#b48cf0" };
// One picture a material, built the first time a back of that material shows.
const seals = new Map<string, string>();
function sealImage(material: string): string {
  let url = seals.get(material);
  if (!url) seals.set(material, (url = `url("${svgDataUri(svgDoc(sealInk(SEAL_INK[material] ?? SEAL_INK.common), SEAL, SEAL))}")`));
  return url;
}
const MOOD: Record<string, string> = { fed: "full", peckish: "peckish", hungry: "hungry" };

/**
 * `live`: the back is showing on the card in focus (the Today stage, an opened word), so its
 * material is drawn live (./live), unless the player asked for less motion or the device is low-end.
 */
export function CardBack({ word, mini = false, live = false }: { word: OwnedWord; mini?: boolean; live?: boolean }) {
  const m = materialOf(word.tier);
  const reduced = usePrefersReducedMotion();
  const lowPower = useLowPower();
  const drawLive = live && !mini && !reduced && !lowPower && canDrawLive();
  return (
    <div className={`cb m-${m}`}>
      <div className="cb-mat">
        <div className="cb-tex" />
        {m === "rare" && <div className="cb-brush" />}
        {m === "legendary" && <div className="cb-glitter" />}
        {m === "mythic" && <Facets />}
        {drawLive && <LiveMaterial material={m} />}
      </div>
      <div className="cb-frame" />
      {/* the game's seal, pressed into the material behind the facts (not on a thumbnail: too small to read) */}
      {!mini && <div aria-hidden className="cb-seal" style={{ backgroundImage: sealImage(m) }} />}
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

/** The rarity: the tier's own mark (lib/tierMark: a bead, then three to six corners) and its name.
 *  On a plate on a thumbnail's back, where it must read at a glance; lettered on the material otherwise. */
function TierPlate({ tier, plate = false }: { tier: Tier; plate?: boolean }) {
  return (
    <span className={`cb-tier ${plate ? "cb-plate" : "cb-tier-set"}`}>
      <TierMark tier={tier} className="cb-gem" />
      {tier}
    </span>
  );
}

/** A thumbnail's back (a Bag card): the rarity, the tiles, and one line. Reads nothing. */
function MiniBody({ word }: { word: OwnedWord }) {
  return (
    <div className="cb-body">
      <div className="cb-top">
        <TierPlate tier={word.tier} plate />
      </div>
      <div className="cb-main">
        <div className="cb-wordcol">
          <Rack word={word} />
          <p className="cb-mini cb-plate">One of one · {ascensionLabel(word.prestigeLevel)}</p>
        </div>
      </div>
    </div>
  );
}

const DASH = "–";

/** The back's words for its facts: one wording for the back and the rows under an opened card. */
function says(f: CardFacts) {
  return {
    found:
      f.found.kind === "you" ? "you" : f.found.kind === "other" ? (f.found.name ? `@${f.found.name}` : `${f.found.address.slice(0, 6)}…${f.found.address.slice(-4)}`) : DASH,
    earned: f.earned === null ? DASH : f.earned > 0 ? `${fmtWord(f.earned)} $WORD` : "None yet",
    perDay: f.perDay === "upper" ? "Once UPPERCASE" : f.perDay === null ? DASH : `~${fmtWord(f.perDay)} a day`,
    cost: f.cost === null ? DASH : `~${fmtWord(f.cost)} $WORD`,
    jackpot: f.drawn === null ? null : f.drawn === "never" ? "Never drawn for the jackpot" : `Drawn for the jackpot (draw ${f.drawn})`,
  };
}

/** The token on the explorer, in the chain game only (the practice game has no contracts). */
function tokenHrefOf(word: string, chain: boolean): string | null {
  return chain ? `${NETWORK.explorer}/nft/${addressOf("words")}/${tokenIdOf(word).toString()}` : null;
}

function FullBody({ word }: { word: OwnedWord }) {
  const f = useCardFacts(word);
  const { state } = useGame();
  const s = says(f);
  const tokenHref = tokenHrefOf(word.word, state.chainBacked);
  const digits = cardDigits(f.number);
  return (
    <div className="cb-body">
      <div className="cb-top">
        <TierPlate tier={f.tier} />
      </div>
      <div className="cb-main">
        <div className="cb-wordcol">
          {/* the card's number, the back's headline; while it isn't known there is none (never a dash that looks like a number) */}
          {digits && (
            <p className="cb-no">
              <small>No.</small>
              {digits}
            </p>
          )}
          <div className="cb-rule" />
          <div className="cb-oneof">
            <b>One of one</b>
            <span>
              One of {fmt(f.ofTier)} {f.tier} words
            </span>
          </div>
          <Rack word={word} />
        </div>
        <dl className="cb-stats">
          <Stat label="Case">{f.caseLabel}</Stat>
          <Stat label="Ascension">
            {f.ascension} <Pips level={f.level} />
          </Stat>
          <Stat label="Yours since">{f.since ?? DASH}</Stat>
          <Stat label="Staked">{f.staked ? `Yes, ${MOOD[f.mood]}` : "No"}</Stat>
          <Stat label="Earned so far" more>
            {s.earned}
          </Stat>
          <Stat label="Earns staked" more>
            {s.perDay}
          </Stat>
          <Stat label="Cost to make" more>
            {s.cost}
          </Stat>
          <Stat label="Points" more>
            {f.points}
          </Stat>
        </dl>
      </div>
      <div className="cb-foot">
        <span>
          Found by <b>{s.found}</b>
        </span>
        {s.jackpot && <span>{s.jackpot}</span>}
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

/** One line of the ledger: its name, a row of dots, its value. */
function Stat({ label, more = false, children }: { label: string; more?: boolean; children: ReactNode }) {
  return (
    <div className={`cb-stat ${more ? "cb-more" : ""}`}>
      <dt>{label}</dt>
      <i aria-hidden />
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

/**
 * What a phone-sized back leaves out (globals.css: under 560 px it shows four stats; under 430 px
 * it also drops how many words share the rarity), listed under an opened card while its back is
 * up, so a phone player sees the whole story too: how many words share its rarity, who found it,
 * what it earns and costs, its points, the jackpot, and its token. Hidden wherever the back is wide
 * enough to show them itself (the same 560 px, by container query).
 */
export function CardMore({ word }: { word: OwnedWord }) {
  const f = useCardFacts(word);
  const { state } = useGame();
  const s = says(f);
  const tokenHref = tokenHrefOf(word.word, state.chainBacked);
  return (
    <dl className="sc-more">
      {/* a phone's back has no room for this line (globals.css, under 430 px), so it is said here */}
      <Row label="Rarity" phone>
        One of {fmt(f.ofTier)} {f.tier} words
      </Row>
      <Row label="Found by">{s.found}</Row>
      <Row label="Earned so far">{s.earned}</Row>
      <Row label="Earns staked">{s.perDay}</Row>
      <Row label="Cost to make">{s.cost}</Row>
      <Row label="Points">{f.points}</Row>
      <Row label="Jackpot">{s.jackpot ?? DASH}</Row>
      <Row label="Token">
        {tokenHref ? (
          <a href={tokenHref} target="_blank" rel="noreferrer" className="underline underline-offset-2" aria-label={`${word.word} on the block explorer`}>
            {f.token}
          </a>
        ) : (
          f.token
        )}
      </Row>
    </dl>
  );
}

/** `phone`: a row only for a card as narrow as a phone's (it repeats a line a wider back shows itself). */
function Row({ label, phone = false, children }: { label: string; phone?: boolean; children: ReactNode }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${phone ? "sc-more-phone" : ""}`}>
      <dt className="shrink-0 font-semibold text-ink/60">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
