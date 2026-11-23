import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { TileWord } from "@/components/game/TileCharacter";
import { parseShowcase, showcaseCardUrl, showcaseText, showcaseUrl } from "@/lib/showcase";
import { BASE_APP_ID, embedsWithImage } from "@/lib/site";

/**
 * A shared Showcase (lib/showcase): the page an X or Farcaster link opens. Its metadata is the
 * point: X reads `og:image` (the letters, 1.91:1) and Farcaster reads `fc:miniapp` (the same
 * letters, 3:2, with the launch button). A person who taps through sees the letters and a way in.
 */
type Props = { params: Promise<{ text: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const tiles = parseShowcase((await params).text);
  if (!tiles) return {};
  const text = showcaseText(tiles);
  const title = `${text} · a Lexigotchi showcase`;
  const description = "Lexigotchi is a tamagotchi-style letter game on Base. Raise your own letters.";
  const card = { url: showcaseCardUrl(text), width: 1200, height: 630, alt: `${text}, spelled in Lexigotchi tiles` };
  const embeds = embedsWithImage(showcaseCardUrl(text, "fc"));
  return {
    title,
    description,
    alternates: { canonical: showcaseUrl(text) },
    openGraph: { title, description, url: showcaseUrl(text), images: [card] },
    twitter: { card: "summary_large_image", title, description, images: [card] },
    other: {
      "fc:miniapp": JSON.stringify(embeds.miniapp),
      "fc:frame": JSON.stringify(embeds.frame),
      "base:app_id": BASE_APP_ID,
    },
  };
}

export default async function ShowcasePage({ params }: Props) {
  const tiles = parseShowcase((await params).text);
  if (!tiles) notFound();
  const text = showcaseText(tiles);
  const word = tiles.map((t) => t.char).join("");
  const upper = tiles.map((t) => t.upper);
  // The characters hold hands (each overlaps the last by 14% of a width), so n tiles span
  // (0.86n + 0.14) widths. Fit that to a phone (~340px) and to a wider screen (~600px).
  const span = 0.86 * tiles.length + 0.14;
  const phone = Math.min(58, Math.floor(340 / span));
  const wide = Math.min(96, Math.floor(600 / span));

  return (
    <main className="flex min-h-[100dvh] flex-col items-center justify-center gap-8 bg-paper px-4 py-12 text-ink">
      <p className="rounded-full border-2 border-ink bg-gold px-3 py-1 text-xs font-extrabold uppercase tracking-wider shadow-[2px_2px_0_#1b1714]">
        A Lexigotchi showcase
      </p>
      <div className="flex w-full max-w-3xl justify-center overflow-hidden">
        <TileWord word={word} upper={upper} detail="full" size={phone} className="sm:hidden" />
        <TileWord word={word} upper={upper} detail="full" size={wide} className="hidden sm:flex" />
      </div>
      <h1 className="sr-only">{text}</h1>
      <p className="max-w-md text-center text-lg font-semibold text-ink/75">
        Lexigotchi is a tamagotchi-style letter game on Base. Collect letter characters, roll them to UPPERCASE, and claim real words.
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
    </main>
  );
}
