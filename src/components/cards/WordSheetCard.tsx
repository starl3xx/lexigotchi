"use client";
/**
 * The opened word's card, at the top of its sheet: the word in its scene, in focus (so it moves:
 * the scene, the bounce, the finish's moments), turned over with the button in its corner. Under it,
 * the Showcase's two jobs, folded in (starl3xx, 2026-11-25: "fold showcase into the bag"): pick the
 * word's scene, and share it. A word in a case (./CardCase, decisions.md #42) shows in it, and the
 * Case button puts a word in a case or takes it out.
 */
import { useState } from "react";
import { NETWORK } from "@/lib/onchain/network";
import { caseOffer, type CaseOffer } from "@/lib/shop/cases";
import { usdcLabel } from "@/lib/shop/rules";
import { useProfile } from "../game/useProfile";
import { useWordCases, type WordCases } from "../game/useShop";
import { CardCase } from "./CardCase";
import { SceneFrame, toneOf } from "../scenes/SceneFrame";
import { useWordScene } from "../scenes/useWordScene";
import type { Gild } from "../game/TileCharacter";
import { careState } from "../game/LetterTile";
import { Button } from "../game/primitives";
import { CircleNotch, DownloadSimple, Package, Palette, ShareNetwork, XLogo } from "../game/ui/icons";
import { useGame, type OwnedWord } from "../game/state";
import { usePostToX, useSaveImage, useShare } from "../game/useShare";
import { showcaseCardPath, showcasePostText, showcaseUrl, showcaseWordText, showcaseXText } from "@/lib/showcase";
import { SceneCard } from "./SceneCard";
import { CardMore } from "./CardBack";
import { ShareVideo } from "./ShareVideo";
import { useCardNumber } from "./useCardNumber";
import { flipKey, useFlipOf } from "./useFlipOf";
import { useCollabLook } from "@/components/game/collabLooksContext";
import type { WakeAct } from "@/components/game/wake/useWakeAct";

export function WordSheetCard({ word, act }: { word: OwnedWord; /** its part in a wake (game/wake) */ act: WakeAct }) {
  const g = useGame();
  const { scene } = useWordScene(word.word);
  const number = useCardNumber(word.word);
  const [sharing, setSharing] = useState(false);
  const [casing, setCasing] = useState(false);
  const cases = useWordCases();
  const cased = cases.cased.has(word.word);
  // The Case button: for a word in a case, a player with a case, or one who can buy a case now.
  // Never on a guess (lib/shop/cases, caseOffer): while what they have isn't known, no button.
  const offer = caseOffer(word.word, cases);
  const caseDoor = offer.kind !== "none";
  // Turned over, remembered with how the card is shown: the case and the bare card are two
  // components, and one that takes the other's place starts on its front, from its first render.
  const [back, setBack] = useFlipOf(flipKey(word.word, cased));
  // while the share loop is made, it holds the one WebGL context: the live back waits
  const [making, setMaking] = useState(false);
  const face = careState(word);
  // what the letters wear while the word is woken; a tap on the card ends the act
  const woke = { states: act.states, armsUp: act.armsUp, moments: act.moments, tone: act.tone ?? toneOf(face) };
  const gild = Math.max(0, Math.min(5, Math.round(word.prestigeLevel))) as Gild;
  return (
    // the card's width decides, by container query, whether the rows a phone-sized back leaves out
    // are listed under it (CardMore)
    <div className={`sc-more-host mb-3 space-y-2 ${cased ? "cc-host" : ""}`}>
      {cased ? (
        // in its case: the case is the card's turn, and it turns with a drag here
        <CardCase
          key={word.word}
          word={word}
          drag
          since={cases.cased.get(word.word)}
          onFlip={setBack}
          front={<SceneFrame scene={scene} word={word.word} upper={word.upper} state={face} {...woke} gild={gild} tier={word.tier} number={number} animated={!back} onWord={act.acting ? act.hurry : undefined} wordLabel={act.acting ? `${word.word} is awake again` : undefined} />}
        />
      ) : (
        <SceneCard
          word={word}
          framed
          flipped={back}
          live={!making}
          onFlip={setBack}
          front={<SceneFrame scene={scene} word={word.word} upper={word.upper} state={face} {...woke} gild={gild} tier={word.tier} number={number} animated={!back} onWord={act.acting ? act.hurry : undefined} wordLabel={act.acting ? `${word.word} is awake again` : undefined} />}
        />
      )}
      {back && <CardMore word={word} />}
      <div className={`sc-actions ${caseDoor ? "sc-actions-3" : ""}`}>
        <Button variant="ghost" onClick={() => g.openSheet({ kind: "scene", word: word.word, fromWord: true })}>
          <Palette weight="fill" /> Face
        </Button>
        <Button variant={sharing ? "primary" : "ghost"} aria-expanded={sharing} onClick={() => setSharing((s) => !s)}>
          <ShareNetwork weight="fill" /> Share
        </Button>
        {caseDoor && (
          <Button variant={casing ? "primary" : "ghost"} aria-expanded={casing} onClick={() => setCasing((c) => !c)}>
            <Package weight="fill" /> Case
          </Button>
        )}
      </div>
      {casing && caseDoor && <CasePanel word={word} cases={cases} offer={offer} />}
      {/* Mounted only when asked for: saving the picture fetches it ahead on phones. */}
      {sharing && <ShareWord word={word} onMaking={setMaking} />}
    </div>
  );
}

/**
 * Share the word in its scene: X first, Farcaster second (lib/showcase), or keep the picture. The
 * link's card draws the word in this scene; a saved picture carries the game's name in a corner.
 */
function ShareWord({ word, onMaking }: { word: OwnedWord; onMaking: (making: boolean) => void }) {
  const share = useShare();
  const postToX = usePostToX();
  const { scene } = useWordScene(word.word);
  const text = showcaseWordText(word.word, word.upper);
  const look = useCollabLook(word.word);
  const saveImage = useSaveImage(showcaseCardPath(text, "x", scene, true, word.prestigeLevel, look?.mark), `lexigotchi-${word.word.toLowerCase()}-${scene}.png`);
  return (
    <div className="space-y-2 rounded-2xl border-2 border-ink bg-card p-2.5">
      <Button full variant="primary" onClick={() => postToX({ text: showcaseXText(text), url: showcaseUrl(text, scene, word.prestigeLevel) })}>
        <XLogo weight="bold" /> Post {word.word} on X
      </Button>
      {/* X's composer shows no card for a link it hasn't read yet, and each new word or scene is a
          new link: the card comes once X has read it (tested 2026-11-24, even with a fast image). */}
      <p className="text-center text-xs text-ink/55">X adds the picture once it reads the link.</p>
      <div className="grid grid-cols-2 gap-2">
        <Button variant="ghost" onClick={() => share({ text: showcasePostText(text), embed: showcaseUrl(text, scene, word.prestigeLevel) })}>
          <ShareNetwork weight="fill" /> Cast
        </Button>
        <Button variant="ghost" onClick={() => void saveImage()}>
          <DownloadSimple weight="bold" /> Save image
        </Button>
      </div>
      {/* the card turning over, as a video to post or keep (made only when asked: ./ShareVideo) */}
      <ShareVideo word={word} text={text} scene={scene} onMaking={onMaking} />
    </div>
  );
}

/** "JAZZY", "JAZZY and PLUMB", "JAZZY, PLUMB, and QUARTZ". */
function listWords(words: readonly string[]): string {
  if (words.length <= 2) return words.join(" and ");
  return `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;
}

/**
 * Put this word in a case, or take it out (decisions.md #42). One case holds one word, and the
 * server counts (`/api/cases`): this only says what `caseOffer` allows. Every case in use is
 * listed with a way to take its word out, so a case is never stuck on a word the player can't
 * open. Saving needs the wallet's profile session; without one the wallet asks to sign in first.
 */
function CasePanel({ word, cases, offer }: { word: OwnedWord; cases: WordCases; offer: CaseOffer }) {
  const g = useGame();
  const profile = useProfile();
  const [busy, setBusy] = useState<string | null>(null);
  const W = word.word;

  const act = async (target: string, on: boolean) => {
    if (busy) return;
    setBusy(target);
    try {
      const token = await profile.ensureToken();
      if (!token) return; // they closed the sign-in
      const r = await cases.set(target, on, token);
      if (r === "ok") g.toast(on ? `${target} is in its case.` : `${target} is out of its case.`, "good");
      else if (r === "none_left") g.toast("Every case you have holds a word. Take one out first.", "bad");
      else if (r === "no_session") {
        profile.signOut();
        g.toast("That sign-in ran out. Try again.", "bad");
      } else g.toast("Couldn’t save that. Try again.", "bad");
    } finally {
      setBusy(null);
    }
  };
  const spinner = (target: string) => busy === target && <CircleNotch className="animate-spin" />;
  const signInFirst = !profile.signedIn && <p className="text-center text-xs text-ink/55">Your wallet asks you to sign in first.</p>;
  const shopButton = (label: string, variant: "primary" | "ghost") =>
    cases.onSale && (
      <Button full variant={variant} onClick={() => g.nav("shop", "accessories")}>
        {label} in the Shop: {usdcLabel(cases.onSale.priceUsdc, NETWORK.isTestnet)}
      </Button>
    );

  return (
    <div className="space-y-2 rounded-2xl border-2 border-ink bg-card p-2.5 text-sm">
      {offer.kind === "cased" && (
        <>
          <p className="text-center text-ink/75">{W} is in a case. Drag the case to turn it.</p>
          <Button full variant="ghost" disabled={busy !== null} onClick={() => void act(W, false)}>
            {spinner(W)} Take {W} out
          </Button>
          {signInFirst}
        </>
      )}
      {offer.kind === "put" && (
        <>
          <p className="text-center text-ink/75">{offer.free === 1 ? "You have a case free." : `You have ${offer.free} cases free.`} One case holds one word.</p>
          <Button full variant="teal" disabled={busy !== null} onClick={() => void act(W, true)}>
            {spinner(W)} Put {W} in a case
          </Button>
          {signInFirst}
        </>
      )}
      {offer.kind === "full" && (
        <>
          <p className="text-center text-ink/75">
            {offer.holding.length === 1 ? `Your case holds ${offer.holding[0]}.` : `Your cases hold ${listWords(offer.holding)}.`} Take a word out to use its case here.
          </p>
          {offer.holding.map((w) => (
            <Button key={w} full variant="ghost" disabled={busy !== null} onClick={() => void act(w, false)}>
              {spinner(w)} Take {w} out
            </Button>
          ))}
          {signInFirst}
          {offer.more && shopButton("Get another case", "ghost")}
        </>
      )}
      {offer.kind === "buy" && (
        <>
          <p className="text-center text-ink/75">A clear case for a word’s card, with a label of its own. One case holds one word.</p>
          {shopButton("Get a case", "primary")}
        </>
      )}
    </div>
  );
}
