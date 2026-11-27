"use client";
/**
 * One thing in the Shop, opened from its card (decisions.md #55; starl3xx, 2026-11-27: "in the shop
 * I should be able to click items and see more info about them, see them at higher size, etc").
 *
 * - **Seen large.** The thing at the dialog's width, and the dialog is a wide one on a computer
 *   (primitives, Sheet `wide`). "Look closer" shows a card face at twice that, in a box that pans:
 *   a phone's screen is no wider than the Shop's own card, so this is a phone's larger size. The
 *   change of size is a cut, never an animation (nothing with a letter on it is scaled in motion,
 *   decisions.md #48).
 * - **Seen on the player's own word.** A card face shows with one of their words standing on it, in
 *   that word's rarity and gilding; a row of their words picks which, and "No word" shows the face
 *   alone. It is a PREVIEW: it draws the face directly and saves no pick. With no wallet or no
 *   words the face shows alone, never with a made-up word on it.
 * - **The same Buy as the card** (shop/ShopBuy). One rule decides it for both (lib/shop/offer).
 * - **A face the player has can be put on the word shown**, with the face picker's own save
 *   (scenes/useWordScene), and only on a positive "you have it".
 * - **It reads the Shop live, by the item's id**, so "2 left" and "You have it" follow a purchase.
 *   An item that has gone, or a Shop that couldn't say what its items are, says so plainly: the
 *   view never falls back to the test network's placeholder card.
 */
import { useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Button, Pill, Sheet } from "../primitives";
import { careState } from "../LetterTile";
import { CircleNotch, MagnifyingGlass } from "../ui/icons";
import { useGame, type OwnedWord } from "../state";
import type { Gild } from "../TileCharacter";
import { useOpenUrl } from "../useShare";
import { useShopView, type ItemAbout } from "../useShop";
import { KIND_NAME, ShopBuy, itemWords } from "../shop/ShopBuy";
import { SceneFrame, SceneThumb } from "../../scenes/SceneFrame";
import { useWordScene } from "../../scenes/useWordScene";
import { CaseThumb } from "../../cards/CardCase";
import { useCardNumber } from "../../cards/useCardNumber";
import { NETWORK } from "@/lib/onchain/network";
import { sceneMeta, type SceneId } from "@/lib/scenes";
import { saleWindow } from "@/lib/shop/offer";
import { editionLine, usdcLabel, type ShopCard } from "@/lib/shop/rules";
import { DOCS_URL } from "@/lib/site";

type ItemCard = Extract<ShopCard, { kind: "item" }>;

export function ShopItemSheet({ id, word }: { id: number; word?: string }) {
  const g = useGame();
  const v = useShopView();
  const card = v.known ? v.cards.find((c): c is ItemCard => c.kind === "item" && c.item.id === id) : undefined;
  const about = card ? v.about(card) : null;
  // The wide dialog is for a picture seen large. A thing with no picture yet (a costume with no
  // art) is its words alone, in the usual dialog and one column.
  const pictured = !!about && (!!about.scene || about.isCase);
  return (
    <Sheet open onClose={g.closeSheet} title={card ? card.meta.name : "The Shop"} wide={pictured}>
      {card && about ? (
        <ItemView card={card} about={about} pictured={pictured} now={v.now} poolPct={v.poolPct} word={word} />
      ) : v.loading ? (
        <div className="flex items-center justify-center gap-2 py-8 text-sm text-ink/60">
          <CircleNotch className="animate-spin" /> Opening the Shop…
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-ink/60">{v.known ? "This isn’t in the Shop right now." : "The Shop didn’t load. Close this and come back."}</p>
      )}
    </Sheet>
  );
}

/** A sale's end or start, in the reader's own time: "December 12, 4:00 PM". */
const when = (sec: number) => new Date(sec * 1000).toLocaleString(undefined, { month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

function ItemView({ card, about, pictured, now, poolPct, word }: { card: ItemCard; about: ItemAbout; pictured: boolean; now: number; poolPct: number; word?: string }) {
  const g = useGame();
  const openUrl = useOpenUrl();
  const testnet = NETWORK.isTestnet;
  const words = g.state.words;
  // The word the face is shown on. Until the player chooses: the word the link named (the face
  // picker's word), else their first. A choice of "No word" is a choice: `{ word: null }`.
  const [choice, setChoice] = useState<{ word: string | null } | null>(null);
  const named = choice ? words.find((w) => w.word === choice.word) : (words.find((w) => w.word === word) ?? words[0]);
  const on = about.scene ? (named ?? null) : null;
  const sale = saleWindow(card.item, now);
  const face = about.scene;

  return (
    <div className={`space-y-4 pb-2 ${pictured ? "lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start lg:gap-5 lg:space-y-0" : ""}`}>
      <div hidden={!pictured} className="min-w-0 space-y-3">
        {face ? (
          <Closer>{on ? <OnWord scene={face} w={on} /> : <SceneThumb scene={face} />}</Closer>
        ) : about.isCase ? (
          // a case shows what it is: empty, around a card with no word on it
          <div className="mx-auto w-4/5">
            <CaseThumb>
              <SceneThumb scene="stock" tier="Rare" />
            </CaseThumb>
          </div>
        ) : null}
        {face && words.length > 0 && (
          <div>
            <div className="text-xs font-bold text-ink/60">See it on</div>
            {/* A player may hold dozens of words: one line that scrolls sideways on a phone, and
                at most three lines on a computer, so the row never pushes the price off the screen. */}
            <div role="radiogroup" aria-label="See it on" className="shop-words mt-1 flex gap-1.5 overflow-x-auto pb-1 md:max-h-[6.75rem] md:flex-wrap md:overflow-y-auto md:overflow-x-hidden">
              {[null, ...words].map((w) => {
                const picked = (w?.word ?? null) === (on?.word ?? null);
                return (
                  <button
                    key={w?.word ?? ""}
                    type="button"
                    role="radio"
                    aria-checked={picked}
                    onClick={() => setChoice({ word: w?.word ?? null })}
                    className="group round-btn shrink-0 rounded-full"
                  >
                    <Pill className={picked ? "bg-ink text-paper" : "bg-card transition-colors group-hover:bg-paper-dark"}>{w ? w.word : "No word"}</Pill>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div>
          <div className="text-xs font-bold text-ink/60">{KIND_NAME[card.meta.kind]}</div>
          <div className="font-display text-xl font-extrabold">{usdcLabel(card.item.priceUsdc, testnet)}</div>
        </div>
        <p className="text-sm text-ink/75">
          {/* a face's own line first ("A small world under the stars."), then what any face is */}
          {face && <strong className="text-ink">{sceneMeta(face).blurb} </strong>}
          {itemWords(card, about)}
        </p>
        {(about.limited || sale || about.have) && (
          <div className="space-y-1 text-sm">
            {about.limited && <div className="font-bold text-ink/75">{editionLine(about.limited)}</div>}
            {sale && <div className="text-ink/75">{"until" in sale ? `On sale until ${when(sale.until)}.` : `On sale from ${when(sale.from)}.`}</div>}
            {about.have && <div className="font-bold text-teal-ink">{about.owned > 1 ? `You have ${about.owned}` : "You have it"}</div>}
          </div>
        )}
        <ShopBuy card={card} about={about} size="md" />
        {/* Only on a positive "you have it" (the offer's own answer), and only for the word shown. */}
        {face && on && about.offer.kind === "have" && <PutOn scene={face} w={on} />}
        <ul className="space-y-1.5 border-t-2 border-ink/15 pt-3 text-xs text-ink/60">
          <li>It stays with your profile. It never goes with a word you sell, dissolve, or move.</li>
          <li>
            Paid in {testnet ? "test USDC" : "USDC"} on {NETWORK.name}. {100 - poolPct}% goes to the studio, and {poolPct}% buys $WORD for the Rewards Pool in the same
            transaction.
          </li>
          <li>
            <button type="button" onClick={() => void openUrl(`${DOCS_URL}/shop`)} className="underline">
              How the Shop works
            </button>
          </li>
        </ul>
      </div>
    </div>
  );
}

/** A card face with the player's word standing on it, as the face picker shows it: clear, never
 *  greyed or fogged by hunger (the player is looking at the face). */
function OnWord({ scene, w }: { scene: SceneId; w: OwnedWord }) {
  const number = useCardNumber(w.word);
  const gild = Math.max(0, Math.min(5, Math.round(w.prestigeLevel))) as Gild; // 5 = Holographic
  return <SceneFrame scene={scene} word={w.word} upper={w.upper} state={careState(w)} gild={gild} tier={w.tier} number={number} />;
}

/** Put a face the player has on the word shown: the face picker's own save, from here. */
function PutOn({ scene, w }: { scene: SceneId; w: OwnedWord }) {
  const { scene: showing, set } = useWordScene(w.word);
  if (showing === scene) return <p className="text-center text-sm font-bold text-ink/60">{w.word}’s card has this face.</p>;
  return (
    <Button variant="ghost" full onClick={() => set(scene)}>
      Put it on {w.word}
    </Button>
  );
}

/**
 * A card's front in its bordered box, and a closer look: the same drawing at twice the width, in
 * the same box, panned by a finger or a trackpad (the box scrolls) or dragged by a mouse.
 */
function Closer({ children }: { children: ReactNode }) {
  const [close, setClose] = useState(false);
  const view = useRef<HTMLDivElement>(null);
  // a closer look starts on the middle of the card
  useLayoutEffect(() => {
    const el = view.current;
    if (!el || !close) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [close]);
  // A mouse has no way to scroll sideways, so it drags the picture. Touch and pen scroll natively.
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = view.current;
    if (!close || !el || e.pointerType !== "mouse" || e.button !== 0) return;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    el.setPointerCapture(e.pointerId);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = view.current;
    const d = drag.current;
    if (!el || !d) return;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const onUp = () => void (drag.current = null);
  return (
    <div className="space-y-1.5">
      <div className="card-corner overflow-hidden border-[3px] border-ink">
        <div
          ref={view}
          className={`shop-closer ${close ? "is-close cursor-grab overflow-auto active:cursor-grabbing" : "overflow-hidden"}`}
          style={{ aspectRatio: "16 / 9" }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
        >
          <div style={{ width: close ? "200%" : "100%" }}>{children}</div>
        </div>
      </div>
      <div className="flex justify-end">
        <button type="button" aria-pressed={close} onClick={() => setClose((c) => !c)} className="flex items-center gap-1 text-xs font-bold text-ink/60 underline">
          <MagnifyingGlass weight="bold" size={12} aria-hidden />
          {close ? "Show the whole card" : "Look closer"}
        </button>
      </div>
    </div>
  );
}
