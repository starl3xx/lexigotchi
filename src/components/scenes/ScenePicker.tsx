"use client";
/**
 * Pick a word's scene: every scene as a still thumbnail (the card's art in its frame, in the
 * word's rarity), the word's own one marked, and the locked ones shown with what opens them
 * (lib/scenes: own SCENE_UNLOCK_WORDS words). A Shop scene the player has bought is picked like any
 * other; one they can buy shows with its price and opens the Shop (game/useShop). Used by the scene
 * sheet (from the Today stage, or from an opened word's card).
 */
import type { Tier } from "@/lib/economy";
import { FREE_SCENES, SCENES, isShopScene } from "@/lib/scenes";
import { usdcLabel } from "@/lib/shop/rules";
import { NETWORK } from "@/lib/onchain/network";
import { Lock, ShoppingBag } from "../game/ui/icons";
import { useGame } from "../game/state";
import { useShopScenes } from "../game/useShop";
import { SceneThumb } from "./SceneFrame";
import { useSceneUnlock, useWordScene } from "./useWordScene";

export function ScenePicker({ word, tier }: { word: string; tier?: Tier }) {
  const g = useGame();
  const { scene, set } = useWordScene(word);
  const { unlocked, count, need } = useSceneUnlock();
  const shop = useShopScenes();
  // A Shop scene is listed only when the player has it, or can buy it now: one that nobody can get
  // (the Shop hasn't listed it, or is switched off) isn't shown at all.
  const scenes = SCENES.filter((s) => !isShopScene(s.id) || shop.bought.has(s.id) || shop.onSale.has(s.id));
  return (
    <div className="space-y-2">
      {!unlocked && (
        <p className="flex items-center justify-center gap-1.5 rounded-xl border-2 border-dashed border-ink/30 px-3 py-2 text-center text-sm text-ink/70">
          <Lock weight="fill" className="shrink-0" />
          <span>
            Own {need} words to unlock every scene for good. You’re at {count}.
          </span>
        </p>
      )}
      <div role="radiogroup" aria-label={`${word}’s scene`} className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {scenes.map((s) => {
          const on = scene === s.id;
          // In the Shop, not bought: the tile opens the Shop, where the scene is for sale.
          const forSale = isShopScene(s.id) && !shop.bought.has(s.id) ? shop.onSale.get(s.id) : undefined;
          if (forSale) {
            const price = usdcLabel(forSale.priceUsdc, NETWORK.isTestnet);
            return (
              <button
                key={s.id}
                type="button"
                title={`${s.blurb} In the Shop for ${price}.`}
                aria-label={`${s.name}, in the Shop for ${price}`}
                onClick={() => g.openSheet({ kind: "shop" })}
                className="cel-sm press relative flex flex-col gap-1 rounded-xl bg-card p-1 text-left"
              >
                <span className="block overflow-hidden rounded-lg border-2 border-ink">
                  <SceneThumb scene={s.id} tier={tier} />
                </span>
                <span className="flex items-center gap-1 truncate px-0.5 text-xs font-bold">
                  <ShoppingBag weight="fill" size={11} className="shrink-0 text-candy-ink" aria-hidden />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto shrink-0 font-semibold text-ink/60">{price}</span>
                </span>
              </button>
            );
          }
          const open = FREE_SCENES.includes(s.id) || isShopScene(s.id) || unlocked;
          return (
            <button
              key={s.id}
              role="radio"
              aria-checked={on}
              disabled={!open}
              title={open ? s.blurb : `Own ${need} words to unlock`}
              onClick={() => set(s.id)}
              className={`cel-sm press relative flex flex-col gap-1 rounded-xl p-1 text-left disabled:cursor-not-allowed ${on ? "bg-ink text-paper" : "bg-card"}`}
            >
              <span className={`block overflow-hidden rounded-lg border-2 border-ink ${open ? "" : "opacity-45 grayscale"}`}>
                <SceneThumb scene={s.id} tier={tier} />
              </span>
              <span className="flex items-center gap-1 truncate px-0.5 text-xs font-bold">
                {!open && <Lock weight="fill" size={11} className="shrink-0" aria-label="locked" />}
                {s.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
