import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_URL ?? "https://lexigotchi.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Lexigotchi: raise your letters, spell your words, own the dictionary",
  description:
    "A tamagotchi-style $WORD collection game for the Let’s Have A Word! ecosystem on Base. Mint letter characters, raise them to UPPERCASE, claim words from the dictionary, stake for $WORD, and chase the daily jackpot.",
  openGraph: {
    title: "Lexigotchi",
    description: "Raise your letters. Spell your words. Own the dictionary.",
    url: SITE_URL,
    siteName: "Lexigotchi",
    // The branded 1200×800 PNG card the mini-app embed already uses (og:image must be PNG/JPG).
    images: [{ url: "/embed-image", width: 1200, height: 800, alt: "Lexigotchi" }],
  },
  twitter: { card: "summary_large_image" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="motion-safe:scroll-smooth">
      <body className="font-body min-h-screen">{children}</body>
    </html>
  );
}
