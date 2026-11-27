import type { CSSProperties } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SceneFrame } from "@/components/scenes/SceneFrame";
import { Lockup } from "@/components/brand/Lockup";
import { WordStripLive } from "@/components/WordStrip";
import { tierWith } from "@/lib/rarity";
import { collabSoon } from "@/lib/raritySoon";
import { isWord } from "@/lib/dictionary";
import { parseLinkStage, parseShowcase, showcaseCardUrl, showcaseText, showcaseUrl } from "@/lib/showcase";
import { cardLevelSoon } from "@/lib/onchain/cardLevel";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import type { Gild } from "@/components/game/TileCharacter";
import { parseLinkScene, sceneMeta } from "@/lib/scenes";
import { cardNumberSoon } from "@/lib/onchain/cardNumbers";
import { BASE_APP_ID, embedsWithImage } from "@/lib/site";

/**
 * A shared Showcase (lib/showcase): the page an X or Farcaster link opens. Its metadata is the
 * point: X reads `og:image` (the word's card, 1.91:1) and Farcaster reads `fc:miniapp` (the same,
 * 3:2, with the launch button). A person who taps through sees the word's card and a way in. Only dictionary words (and the game's own house cards) draw; anything else is a 404.
 */
type Props = {
  params: Promise<{ text: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return {};
  const scene = parseLinkScene((await searchParams).scene);
  const text = showcaseText(tiles);
  const title = `${text} · a Lexigotchi showcase`;
  const description = "Lexigotchi is a word-pet game on Base. Collect letters, raise them, and spell words only you can own.";
  // The pictures' addresses name the word's stage (read from the chain, never from this link), so a
  // word shared again after an ascension gets pictures at new addresses (lib/showcase, stageQuery).
  const plain = tiles.map((t) => t.char).join("");
  const stage = await stageOf(plain, parseLinkStage((await searchParams).g));
  // And its collab look, read from the sets (lib/showcase, markQuery): a word shared again after
  // its set's reveal gets pictures at new addresses too.
  const mark = (await collabSoon()).get(plain.toUpperCase())?.mark;
  const card = { url: showcaseCardUrl(text, "x", scene, false, stage, mark), width: 1200, height: 630, alt: `${text} in Lexigotchi tiles, ${sceneMeta(scene).name}` };
  const embeds = embedsWithImage(showcaseCardUrl(text, "fc", scene, false, stage, mark));
  return {
    title,
    description,
    alternates: { canonical: showcaseUrl(text, scene) },
    openGraph: { title, description, url: showcaseUrl(text, scene), images: [card] },
    twitter: { card: "summary_large_image", site: "@lexigotchi", title, description, images: [card] },
    other: {
      "fc:miniapp": JSON.stringify(embeds.miniapp),
      "fc:frame": JSON.stringify(embeds.frame),
      "base:app_id": BASE_APP_ID,
    },
  };
}

/**
 * A dictionary word's ascension stage, from the chain, waited for only a moment; none for a house
 * card or before the game is deployed. `hint` is the stage this page's own link names: never shown,
 * only a reason to read the chain again when it differs from the stage kept a moment ago.
 */
async function stageOf(word: string, hint: number | null): Promise<number | null> {
  return isWord(word) && isSuiteDeployed() ? cardLevelSoon(word, hint) : null;
}

export default async function ShowcasePage({ params, searchParams }: Props) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) notFound();
  const scene = parseLinkScene((await searchParams).scene);
  const text = showcaseText(tiles);
  const word = tiles.map((t) => t.char).join("");
  const upper = tiles.map((t) => t.upper);
  // A house card (HEYOO) is no dictionary word: it has no rarity and no number, and its card says so
  // by carrying no ribbon. A word's number is the chain's, never the link's, and the page waits
  // for it only a moment (cardNumberSoon).
  const collab = await collabSoon();
  const tier = isWord(word) ? tierWith(word, collab) : undefined;
  // The word's collab look, handed to the card: this page is outside the game, where a card looks
  // its own up. `null` for any other word (and a house card).
  const look = collab.get(word.toUpperCase()) ?? null;
  const [number, stage] = await Promise.all([tier ? cardNumberSoon(word) : null, stageOf(word, parseLinkStage((await searchParams).g))]);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 bg-paper px-4 py-12 text-ink">
      {/* the game's lockup, alive, where a gold label said "A Lexigotchi showcase" (decisions.md #56, part 3) */}
      <Link href="/" aria-label="Lexigotchi: how it works">
        <Lockup alive height={40} />
      </Link>
      {/* the card stands on the page (globals.css, .card-stand): its block shadow is on a box of its own, under its ink edge */}
      <div className="card-stand w-full max-w-3xl" style={{ "--card-sy": "4px" } as CSSProperties}>
        <div className="card-corner overflow-hidden border-[3px] border-ink">
          <SceneFrame scene={scene} word={word} upper={upper} tier={tier} number={number} gild={(stage ?? 0) as Gild} collab={look} />
        </div>
      </div>
      <h1 className="sr-only">{text}</h1>
      <p className="max-w-md text-center text-lg font-semibold text-ink/75">
        Lexigotchi is a word-pet game on Base. Collect little letter characters, raise them to UPPERCASE, and spell words nobody else can own.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link
          href="/play"
          className="inline-flex select-none items-center justify-center gap-2 rounded-xl border-[3px] border-ink bg-candy px-6 py-3.5 font-display text-lg font-extrabold text-paper shadow-[3px_3px_0_#1b1714] transition-all hover:-translate-x-px hover:-translate-y-px hover:shadow-[4px_4px_0_#1b1714] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-candy"
        >
          Play Lexigotchi
        </Link>
        <Link href="/" className="font-semibold text-ink/70 underline hover:text-candy">
          How it works
        </Link>
      </div>
      <WordStripLive className="mt-6" />
    </main>
  );
}
