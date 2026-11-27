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
import { TileCharacter, useLowPower, usePrefersReducedMotion, type Gild } from "../game/TileCharacter";
import { TierMark } from "../game/TierMark";
import type { Tier } from "@/lib/economy";
import type { ReactNode } from "react";
import { fmtWord, useGame, type OwnedWord } from "../game/state";
import { ascensionLabel, cardDigits } from "@/lib/cardFacts";
import { footSetName } from "@/lib/backPicture";
import { svgDataUri, svgDoc } from "@/lib/cardArt/engrave";
import { SEAL, sealInk } from "@/lib/cardArt/seal";
import { rackPaths } from "@/lib/cardArt/rack";
import { tokenIdOf } from "@/lib/onchain/tokenId";
import { addressOf } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { MATERIAL_LINE, SCROLL_PATH_CARD, materialOf, type CardMaterial } from "./material";
import { CardStamp, useMyStamp } from "./CardStamp";
import { useCardFacts, type CardFacts } from "./useCardFacts";
import { useCardNumber } from "./useCardNumber";
import dynamic from "next/dynamic";
import { canDrawLive } from "./live/support";
import { tileTierOf, useCollabLook } from "@/components/game/collabLooksContext";

// The live material loads the first time a back goes live: OGL stays out of the game's first download.
const LiveMaterial = dynamic(() => import("./live/LiveMaterial").then((m) => m.LiveMaterial), { ssr: false });

const fmt = (n: number) => n.toLocaleString("en-US");

// One picture a material, built the first time a back of that material shows.
const seals = new Map<string, string>();
function sealImage(material: CardMaterial): string {
  let url = seals.get(material);
  if (!url) seals.set(material, (url = `url("${svgDataUri(svgDoc(sealInk(MATERIAL_LINE[material]), SEAL, SEAL))}")`));
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
      {/* the game's seal, pressed into the material behind the facts */}
      <div aria-hidden className="cb-seal" style={{ backgroundImage: sealImage(m) }} />
      {m === "mythic" && <div className="cb-fire" />}
      {m === "legendary" && !mini && (["tl", "tr", "bl", "br"] as const).map((k) => <Scroll key={k} corner={k} />)}
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
      {stamp && <CardStamp src={stamp} ink={MATERIAL_LINE[materialOf(word.tier)]} place="mini" />}
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
  const ink = MATERIAL_LINE[materialOf(word.tier)];
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
      <Row label="Rarity">
        One of {fmt(f.ofTier)} {f.tier} words
      </Row>
      <Row label="Found by">{s.found}</Row>
      {f.set && <Row label="Set">{f.set}</Row>}
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="shrink-0 font-semibold text-ink/60">{label}</dt>
      <dd className="min-w-0 text-right">{children}</dd>
    </div>
  );
}
