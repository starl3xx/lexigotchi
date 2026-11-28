"use client";
/**
 * The back of a word's card (./SceneCard): the word's story, in its rarity's material. Deep backs
 * (a rich material, cream type), a faint card-stock texture, and the tiles still on a rack in
 * perspective (the "Scene Cards" mock, starl3xx, 2026-11-25).
 *
 * Relettered with the card's front (decisions.md #35, the "Cards, Scenes, and Logo" proposal):
 * - **The card's number is the headline,** large, in the card's serif (Source Serif 4, shipped
 *   with the game), with "One of one" under it.
 * - **The facts are a ledger:** a name, a row of dots, a value. Names in Söhne and as written
 *   (capitals mean a raised letter in this game; the owner: "back word casing can stay as it is"),
 *   values in the card's serif, so the two never blur.
 * - **The game's seal is pressed into the material** in one ink, behind the facts (lib/cardArt/seal;
 *   the owner: "I really like the Pressed, one ink version of the back").
 * - **The word itself is only ever its tiles** (in Söhne, on the rack): no line of text names it.
 * The words stand straight on the material now, with a soft shadow, not on plates.
 *
 * One design at every size and in every place a back shows (starl3xx, 2026-11-26: "the backs need
 * to be redesigned for all sizes / display locations"), sized by the card's own width (globals.css,
 * `.cb`, container queries):
 * - **470 px and wider** (the Today stage on a computer, an opened word): the left column (rarity,
 *   number, "One of one", how many words share the rarity, the rack), the whole ledger, and the
 *   line along the bottom. This is the proposal's back.
 * - **Under 470 px** (a phone's Today stage and opened word): the same two columns with the first
 *   four facts; the rest are listed under an opened card (CardMore).
 * - **A thumbnail** (`mini`: the Bag's grid, about 315 px on a computer and 175 px on a phone): one
 *   column: the rarity, the number, one line, and the rack, with the seal beside them. It reads
 *   only the card's number, which every card on the page shares one request for.
 * The server draws the same back for the share video (app/s/[text]/back).
 *
 * Still, always: no tile bounces or shines on the back (the material is drawn once, by CSS here;
 * a later step draws it live where a card is in focus).
 */
import { TileCharacter, type Gild } from "../game/TileCharacter";
import { TierMark } from "../game/TierMark";
import type { Tier } from "@/lib/economy";
import type { CSSProperties, ReactNode } from "react";
import { fmtWord, useGame, type OwnedWord } from "../game/state";
import { ascensionLabel, cardDigits } from "@/lib/cardFacts";
import { footSetName } from "@/lib/backPicture";
import { svgDataUri, svgDoc } from "@/lib/cardArt/engrave";
import { SEAL, sealInk } from "@/lib/cardArt/seal";
import { rackPaths } from "@/lib/cardArt/rack";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { addressOf } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { MATERIAL_LINE, collabPlate, materialOf, materialPlate } from "./material";
import { CardStamp, useMyStamp } from "./CardStamp";
import { useCardFacts, type CardFacts } from "./useCardFacts";
import { useCardNumber } from "./useCardNumber";
import { tileTierOf, useCollabLook } from "@/components/game/collabLooksContext";
import { collabBack } from "@/lib/collabLook";
import { collabLine } from "@/lib/cardFacts";

const fmt = (n: number) => n.toLocaleString("en-US");

// One picture an ink (a material's line, or a collab set's), built the first time a back in it shows.
const seals = new Map<string, string>();
function sealImage(ink: string): string {
  let url = seals.get(ink);
  if (!url) {
    if (seals.size > 40) seals.clear(); // an admin dragging a color picker makes many inks
    seals.set(ink, (url = `url("${svgDataUri(svgDoc(sealInk(ink), SEAL, SEAL))}")`));
  }
  return url;
}

/**
 * A collab word's back, in its set's colorway (decisions.md, "Collab sets", item 3): the partner's
 * two colors, deepened until the back's cream type reads on them (lib/collabLook.ts `collabBack`),
 * as the CSS variables a material sets (globals.css, `.m-*`). Null for any other word.
 */
function useCollabBack(word: string): { style: CSSProperties; line: string; base: string; base2: string } | null {
  const look = useCollabLook(word);
  if (!look) return null;
  const b = collabBack(look);
  const n = parseInt(b.line.slice(1), 16);
  const line2 = `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, 0.18)`;
  return {
    line: b.line,
    base: b.base,
    base2: b.base2,
    style: { "--cb-base": b.base, "--cb-line": b.line, "--cb-line2": line2, "--rk-front": b.rack } as CSSProperties,
  };
}

/** The ink of a back's frame, seal, and holder's stamp: its material's line, or its collab set's. */
function useBackInk(word: OwnedWord): string {
  return useCollabBack(word.word)?.line ?? MATERIAL_LINE[materialOf(word.tier)];
}
const MOOD: Record<string, string> = { fed: "full", peckish: "peckish", hungry: "hungry" };

// One picture a plate: a rarity's, or a collab set's inks, built the first time a back in it shows.
const plates = new Map<string, string>();
function plateImage(key: string, make: () => string): string {
  let url = plates.get(key);
  if (!url) {
    if (plates.size > 40) plates.clear(); // an admin dragging a color picker makes many inks
    plates.set(key, (url = `url("${svgDataUri(svgDoc(make()))}")`));
  }
  return url;
}

/**
 * A card's back: an engraved plate in its rarity's inks, the game's seal (the same on every rarity), and the
 * word's story lettered over them (decisions.md #58, part 2). It is paper and ink: a still picture,
 * with no material, no frame line of its own (the plate's border is its frame), and nothing drawn
 * live. A collab word's plate is in its set's two inks.
 */
export function CardBack({ word, mini = false }: { word: OwnedWord; mini?: boolean }) {
  const m = materialOf(word.tier);
  const collab = useCollabBack(word.word);
  const plate = collab ? plateImage(`collab:${collab.base}:${collab.base2}:${collab.line}`, () => collabPlate(collab)) : plateImage(m, () => materialPlate(m));
  return (
    <div className={`cb ${collab ? "m-collab" : `m-${m}`}`} style={collab?.style}>
      <div className="cb-mat" style={{ backgroundImage: plate }}>
        <div className="cb-tex" />
      </div>
      {/* the game's seal, pressed into the plate's field, behind the facts: the same on every rarity */}
      <div aria-hidden className="cb-seal" style={{ backgroundImage: sealImage(collab?.line ?? MATERIAL_LINE[m]) }} />
      {mini ? <MiniBody word={word} /> : <FullBody word={word} />}
    </div>
  );
}

/** The rack's shapes, in its own 100 × 20 box: the styles keep every line one weight however the box is stretched. */
const RACK = rackPaths();

function Rack({ word }: { word: OwnedWord }) {
  const gild = Math.max(0, Math.min(5, Math.round(word.prestigeLevel))) as Gild;
  // The rack's tiles are the word's own: a collab word's wear its set's two colors here too.
  const tileTier = tileTierOf(word.tier, useCollabLook(word.word));
  return (
    <div className="cb-rackwrap">
      {/* a tile rack in perspective, engraved (lib/cardArt/rack): its top runs back behind the tiles,
          ruled; its front stands before them, in shadow under closer ruling */}
      <svg className="cb-rack cb-rack-back" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden>
        <path d={RACK.top} className="rk-top" />
        <path d={RACK.topRules} className="rk-rule" />
      </svg>
      <div className="cb-tiles">
        {[...word.word].map((ch, i) => (
          <div key={i} className="cb-tile">
            <TileCharacter char={ch} upper={word.upper[i] ?? false} gild={gild} detail="tile" fluid tier={tileTier} still />
          </div>
        ))}
      </div>
      <svg className="cb-rack cb-rack-front" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden>
        <path d={RACK.front} className="rk-front" />
        <path d={RACK.frontRules} className="rk-rule rk-rule-front" />
        <path d={RACK.edge} className="rk-edge" />
      </svg>
    </div>
  );
}

/** The rarity, lettered on the material at the head of the left column: the tier's own mark
 *  (lib/tierMark: a bead, then three to six corners) and its name, in the card's serif. */
function TierLine({ tier }: { tier: Tier }) {
  return (
    <span className="cb-tier">
      <TierMark tier={tier} className="cb-gem" />
      {tier}
    </span>
  );
}

/** The card's number, the back's headline. None while it isn't known (never a dash that looks like a number).
 *  `stamp`: the holder's stamp, which sits in the number's own line, so it follows the digits at every size. */
function Number({ n, stamp }: { n: number | null; stamp?: ReactNode }) {
  const digits = cardDigits(n);
  return digits ? (
    <p className="cb-no">
      <small>No.</small>
      {digits}
      {stamp}
    </p>
  ) : null;
}

/** A thumbnail's back (a Bag card): the rarity, the number, one line, and the tiles on their rack. */
function MiniBody({ word }: { word: OwnedWord }) {
  const number = useCardNumber(word.word);
  const stamp = useMyStamp();
  const ink = useBackInk(word);
  return (
    <>
      <div className="cb-body">
        <div className="cb-wordcol">
          <TierLine tier={word.tier} />
          <Number n={number} />
          <div className="cb-rule" />
          <p className="cb-mini">One of one · {ascensionLabel(word.prestigeLevel)}</p>
          <Rack word={word} />
        </div>
      </div>
      {/* the holder's stamp: on a thumbnail, beside the number's column, over the pressed seal */}
      {stamp && <CardStamp src={stamp} ink={ink} place="mini" />}
    </>
  );
}

const DASH = "–";

/** Who found a word, in the back's words: "you", their name, their address shortened, or a dash while unknown. */
export function foundBySays(found: CardFacts["found"]): string {
  return found.kind === "you" ? "you" : found.kind === "other" ? (found.name ? `@${found.name}` : `${found.address.slice(0, 6)}…${found.address.slice(-4)}`) : DASH;
}

/** The back's words for its facts: one wording for the back and the rows under an opened card. */
function says(f: CardFacts) {
  return {
    found: foundBySays(f.found),
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
  // The holder's stamp (./CardStamp): the player's own picture, beside the number, or in the top
  // left corner of a card with no number yet.
  const stamp = useMyStamp();
  const ink = useBackInk(word);
  const numbered = cardDigits(f.number) !== null;
  return (
    <>
      {stamp && !numbered && <CardStamp src={stamp} ink={ink} place="corner" />}
      <div className="cb-body">
        <div className="cb-wordcol">
          <TierLine tier={f.tier} />
          <Number n={f.number} stamp={stamp ? <CardStamp src={stamp} ink={ink} place="number" /> : null} />
          <div className="cb-rule" />
          <div className="cb-oneof">
            <b>One of one</b>
            <span>
              One of {fmt(f.ofTier)} {f.tier} words
            </span>
            {/* a collab word: its partner, and its place among the set's five */}
            {f.collab && <span className="cb-collab">{collabLine(f.collab, true)}</span>}
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
      {/* the line along the bottom: who found it, the jackpot, its token (each after a middle dot) */}
      <div className="cb-foot">
        <span>
          Found by <b>{s.found}</b>
        </span>
        {/* a word released in a reserved set carries the set's name (decisions.md, "Reserved word sets") */}
        {f.set && (
          <span>
            Set <b>{footSetName(f.set)}</b>
          </span>
        )}
        {s.jackpot && <span>{s.jackpot}</span>}
        {tokenHref ? (
          <a className="cb-id" href={tokenHref} target="_blank" rel="noreferrer" aria-label={`${word.word} on the block explorer`}>
            {f.token}
          </a>
        ) : (
          <span className="cb-id">{f.token}</span>
        )}
      </div>
    </>
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
        <i key={i} className={i <= level ? "on" : ""} />
      ))}
    </span>
  );
}

/**
 * What a phone-sized back leaves out (globals.css: under 470 px it shows four facts, and has no
 * room for how many words share the rarity or the line along the bottom), listed under an opened
 * card while its back is up, so a phone player sees the whole story too: how many words share its
 * rarity, who found it, what it earns and costs, its points, the jackpot, and its token. Hidden
 * wherever the back is wide enough to show them itself (the same 470 px, by container query).
 */
export function CardMore({ word }: { word: OwnedWord }) {
  const f = useCardFacts(word);
  const { state } = useGame();
  const s = says(f);
  const tokenHref = tokenHrefOf(word.word, state.chainBacked);
  return (
    <dl className="sc-more">
      {/* A fact is in the card's serif. A NAME is not (who found it, its set, its partner): the
          serif never letters a name in the interface (decisions.md #66, part 3). */}
      <Row label="Rarity" fact>
        One of {fmt(f.ofTier)} {f.tier} words
      </Row>
      <Row label="Found by">{s.found}</Row>
      {f.set && <Row label="Set">{f.set}</Row>}
      {f.collab && <Row label="Collab">{collabLine(f.collab)}</Row>}
      <Row label="Earned so far" fact>{s.earned}</Row>
      <Row label="Earns staked" fact>{s.perDay}</Row>
      <Row label="Cost to make" fact>{s.cost}</Row>
      <Row label="Points" fact>{f.points}</Row>
      <Row label="Jackpot" fact>{s.jackpot ?? DASH}</Row>
      <Row label="Token" fact>
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

function Row({ label, fact = false, children }: { label: string; /** a figure or a fact in words: the card's serif. Never set for a name. */ fact?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 font-medium text-ink/70">{label}</dt>
      <dd className={`min-w-0 text-right ${fact ? "fact" : ""}`}>{children}</dd>
    </div>
  );
}
