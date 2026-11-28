"use client";
/**
 * The two things an item's card on the Shop's screen and the item's own view (sheets/ShopItemSheet)
 * must say alike: what the thing is, and whether it can be bought (decisions.md #55).
 *
 * `ShopBuy` draws what lib/shop/offer's `buyOffer` decided and adds nothing to it: the rule is
 * there, tested, so the card and the view can't disagree about selling. A purchase in flight is
 * known to every Buy on the page (`useShopBuy`), so closing the view mid-purchase never leaves a
 * live Buy on the card behind it.
 */
import { Button } from "../primitives";
import { CircleNotch } from "../ui/icons";
import { useGame } from "../state";
import { useShopBuy, type ItemAbout } from "../useShop";
import { NETWORK } from "@/lib/onchain/network";
import { offerIsButton } from "@/lib/shop/offer";
import { usdcLabel, type Availability, type ItemKind, type ShopCard } from "@/lib/shop/rules";

const STATUS: Record<Exclude<Availability, "on_sale">, string> = {
  not_yet: "Not on sale yet",
  ended: "No longer on sale",
  sold_out: "Sold out",
  inactive: "Not on sale",
};

/** One thing of a kind, as a player says it. A card face is the stored kind "scene" (decisions.md #54). */
export const KIND_NAME: Record<ItemKind, string> = { scene: "Card face", case: "Case", costume: "Costume" };

/** What a thing in the Shop is, in a sentence or two: the words on its card. */
export function itemWords(card: ShopCard, about: Pick<ItemAbout, "scene" | "isCase">): string {
  if (card.kind === "placeholder") return "A placeholder on the test network. It does nothing; it’s here so you can try paying.";
  if (about.scene) return "A card face: the picture behind your word, on the front of its card. Buy it once, then pick it for any of your words with the palette button under a card.";
  if (about.isCase) return "A clear case for one word’s card, with a label of its own. Put a word in it with the Case button under its card.";
  return card.meta.kind === "scene" ? "A card face" : "A costume";
}

/** Buy, or the reason there is none. Nothing at all for a thing the player has and can't buy twice. */
export function ShopBuy({ card, about, size = "sm" }: { card: ShopCard; about: ItemAbout; size?: "sm" | "md" }) {
  const g = useGame();
  const { buyingId, buy } = useShopBuy();
  const testnet = NETWORK.isTestnet;
  const o = about.offer;
  if (o.kind === "have") return null;
  // A line of words, or a button: the card asks the same question (offerIsButton) to know whether
  // to lift this above its own open button.
  if (!offerIsButton(o)) {
    return (
      <div className="text-center text-xs font-medium text-ink/70">
        {o.kind === "off" ? STATUS[o.status] : o.why === "checking" ? "Checking what you have…" : "Couldn’t check what you have. Leave the Shop and come back."}
      </div>
    );
  }
  if (o.kind === "connect") {
    return (
      // Today is where a wallet connects; `nav` closes the item's view on the way.
      <Button full size={size} onClick={() => g.nav("home")}>
        Connect a wallet to buy
      </Button>
    );
  }
  return (
    <Button full size={size} disabled={buyingId !== null || o.blocked !== null} onClick={() => void buy({ id: card.item.id, priceUsdc: card.item.priceUsdc })}>
      {buyingId === card.item.id ? (
        <>
          <CircleNotch className="animate-spin" /> Buying…
        </>
      ) : o.blocked === "paused" ? (
        "The Shop is paused"
      ) : o.blocked === "short" ? (
        testnet ? "Not enough test USDC" : "Not enough USDC"
      ) : (
        `Buy for ${usdcLabel(card.item.priceUsdc, testnet)}`
      )}
    </Button>
  );
}
