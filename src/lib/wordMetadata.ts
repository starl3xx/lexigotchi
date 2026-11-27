/**
 * A word's token metadata (decisions.md, "Collab sets", item 3; `Words.tokenURI` = base URI +
 * the decimal token id, served by `GET /api/word/{id}`). What a marketplace or a wallet reads
 * about a word: its name, its picture, and its traits. Pure: the route reads the chain and the
 * sets and hands the facts in.
 *
 * A word is DYNAMIC. Its letters are raised to UPPERCASE and it ascends, so its name, its picture's
 * address, and its traits follow the chain's state now. `Words` emits ERC-4906 `MetadataUpdate`
 * when the chain changes it, and the owner's `refreshMetadata` covers what the chain can't see (a
 * collab set's reveal).
 *
 * What it may say of a SET follows what any visitor may see (lib/sets/rules.ts `publicSets`):
 * "Set" names a word's set once that set is RELEASED, as the card's back does, and "Collab" names
 * the partner from the set's REVEAL. A draft adds nothing. "Rarity" is the tier the game treats
 * the word as (lib/rarity.ts), so a collab word reads Legendary here as it does in the game.
 */
import type { Tier } from "./economy";
import { ascensionLabel } from "./cardFacts";
import { showcaseFacePath, showcaseWordText } from "./showcase";

export interface WordMetaFacts {
  /** UPPERCASE, a dictionary word. */
  word: string;
  /** Each letter's case, by position. */
  upper: readonly boolean[];
  /** Its ascension stage (0: not ascended). */
  level: number;
  /** Its card number, when known. */
  number: number | null;
  /** The tier the game treats it as. */
  tier: Tier;
  /** The name of the RELEASED set it belongs to, or null. */
  setName: string | null;
  /** The partner of the REVEALED or RELEASED collab set it belongs to, or null. */
  collabPartner: string | null;
}

export interface WordMetadata {
  name: string;
  description: string;
  image: string;
  external_url: string;
  attributes: ({ trait_type: string; value: string } | { trait_type: string; value: number; display_type?: "number"; max_value?: number })[];
}

export function wordMetadata(f: WordMetaFacts, site: string): WordMetadata {
  // The word as its letters stand now: CRANE with C, R, A raised is "CRAne".
  const text = showcaseWordText(f.word, f.upper);
  const raised = f.upper.filter(Boolean).length;
  const attributes: WordMetadata["attributes"] = [
    { trait_type: "Rarity", value: f.tier },
    { trait_type: "UPPERCASE letters", value: raised, display_type: "number", max_value: f.word.length },
    { trait_type: "Ascension", value: ascensionLabel(f.level) },
  ];
  if (f.number !== null) attributes.push({ trait_type: "Number", value: f.number, display_type: "number" });
  if (f.setName) attributes.push({ trait_type: "Set", value: f.setName });
  if (f.collabPartner) attributes.push({ trait_type: "Collab", value: f.collabPartner });
  return {
    name: text,
    description: `${f.word} is a word in Lexigotchi, made from five letters. There is one of it.`,
    // The card's front alone, at its stage. The address changes with the word's case and stage, so
    // a marketplace that reads the metadata again gets the new picture.
    image: `${site}${showcaseFacePath(text, undefined, f.level)}`,
    external_url: `${site}/s/${text}`,
    attributes,
  };
}

/** A token id as `tokenURI` writes it: decimal digits (a uint256 is at most 78 of them), or null. */
export function parseTokenId(raw: string): bigint | null {
  if (!/^\d{1,78}$/.test(raw)) return null;
  const id = BigInt(raw);
  return id < 2n ** 256n ? id : null;
}
