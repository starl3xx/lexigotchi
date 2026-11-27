"use client";
/**
 * A card, face down (decisions.md #50, part 4): the day's secret word on the Jackpot page, before
 * it is revealed. starl3xx chose one card over five tiles: "it reinforces that a card has to be
 * held, not individual letters".
 *
 * It is a card's back with the game's seal and nothing else: no number, no facts, no letters.
 *
 * **It takes no word and no rarity, on purpose.** Nothing about the secret word can reach it, so
 * nothing about the word can show. Its material is always the plain one (Common's), whatever the
 * word is worth: a back in the word's own inks would tell every player the word's rarity before it
 * is revealed. (Which plate a face-down card wears is the owner's to decide; Common's is the
 * stand-in he saw on the review page. It is Common's plate: rules and a ruled ground.)
 *
 * Built from the back's own parts (globals.css, `.cb`), so it is a real card's stock, and it
 * stands on the page as a card does (`.card-stand`). Still: it has nothing to turn to.
 */
import { SEAL, sealInk } from "@/lib/cardArt/seal";
import { svgDataUri, svgDoc } from "@/lib/cardArt/engrave";
import { MATERIAL_LINE, materialPlate } from "./material";

// One picture, built the first time a face-down card shows.
let seal: string | undefined;
const sealImage = () => (seal ??= `url("${svgDataUri(svgDoc(sealInk(MATERIAL_LINE.common), SEAL, SEAL))}")`);
let plate: string | undefined;
const plateImage = () => (plate ??= `url("${svgDataUri(svgDoc(materialPlate("common")))}")`);

export function FaceDownCard({ label, className = "" }: { /** What a screen reader says in place of the picture. */ label: string; className?: string }) {
  return (
    <div className={`fd card-stand ${className}`} role="img" aria-label={label}>
      <div className="fd-face card-corner">
        <div className="cb m-common">
          <div className="cb-mat" style={{ backgroundImage: plateImage() }}>
            <div className="cb-tex" />
          </div>
          <div aria-hidden className="fd-seal" style={{ backgroundImage: sealImage() }} />
        </div>
      </div>
    </div>
  );
}
