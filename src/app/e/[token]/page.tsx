import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WordStripLive } from "@/components/WordStrip";
import { parseShowcase } from "@/lib/showcase";
import { parseLinkScene } from "@/lib/scenes";
import { earningsCardPath, earningsCardUrl, earningsShareUrl, parseTz, type EarningsShareLook } from "@/lib/earningsShare";
import { readEarningsShare } from "@/lib/earningsShareToken";
import { BASE_APP_ID, embedsWithImage } from "@/lib/site";

/**
 * A shared "Your earnings" (lib/earningsShare.ts): the page an X or Farcaster link opens. Its
 * metadata is the point: X reads `og:image` (the card, 1.91:1) and Farcaster reads `fc:miniapp`
 * (the same, 3:2, with the launch button). A person who taps through sees the picture and a way in.
 * Only a token this server signed draws; anything else is a 404. Not indexed: every share is its
 * own address.
 */
type Props = {
  params: Promise<{ token: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The link's cosmetic parts, cleaned: a dictionary word, a known scene, a real clock offset. */
function lookOf(q: Record<string, string | string[] | undefined>): EarningsShareLook {
  const hero = parseShowcase(one(q.w) ?? "");
  return {
    hero: hero?.length === 5 ? hero.map((t) => (t.upper ? t.char : t.char.toLowerCase())).join("") : undefined,
    scene: parseLinkScene(q.scene),
    tz: parseTz(one(q.tz)),
  };
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { token } = await params;
  if (!readEarningsShare(token)) return {};
  const look = lookOf(await searchParams);
  const title = "Words at work · Lexigotchi";
  const description = "Lexigotchi is a word-pet game on Base. Collect letters, raise them, and spell words only you can own.";
  const card = { url: earningsCardUrl(token, "x", look), width: 1200, height: 630, alt: "A word’s card in Lexigotchi, beside a tag that says what its player’s words have earned" };
  const embeds = embedsWithImage(earningsCardUrl(token, "fc", look));
  return {
    title,
    description,
    robots: { index: false },
    alternates: { canonical: earningsShareUrl(token, look) },
    openGraph: { title, description, url: earningsShareUrl(token, look), images: [card] },
    twitter: { card: "summary_large_image", site: "@lexigotchi", title, description, images: [card] },
    other: {
      "fc:miniapp": JSON.stringify(embeds.miniapp),
      "fc:frame": JSON.stringify(embeds.frame),
      "base:app_id": BASE_APP_ID,
    },
  };
}

export default async function EarningsSharePage({ params, searchParams }: Props) {
  const { token } = await params;
  if (!readEarningsShare(token)) notFound();
  const look = lookOf(await searchParams);

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 bg-paper px-4 py-12 text-ink">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl border-[3px] border-ink shadow-[4px_4px_0_#1b1714]">
        {/* the same picture the post carries, at 16:9 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={earningsCardPath(token, "wide", look)} width={1200} height={675} alt="A word’s card in Lexigotchi, beside a tag that says what its player’s words have earned" className="block h-auto w-full" />
      </div>
      <p className="max-w-md text-center text-lg font-semibold text-ink/75">
        Lexigotchi is a word-pet game on Base. Collect little letter characters, raise them to UPPERCASE, and spell words nobody else can own. A
        word with all five letters UPPERCASE, staked and fed, earns $WORD every day.
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
