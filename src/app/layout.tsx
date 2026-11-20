import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_URL ?? "https://lexigotchi.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Lexigotchi — raise your letters, spell your words, own the dictionary",
  description:
    "A tamagotchi-style $WORD collection game for the Let's Have A Word! ecosystem on Base. Mint letter characters, raise them to UPPERCASE, claim words from the dictionary, stake for $WORD, and chase the daily jackpot.",
  // Tab icon + Home Screen icon. There was no favicon at all (every page load 404'd /favicon.ico).
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  // iPhone/iPad: a Home Screen launch opens full-screen, which is where iOS allows browser push.
  appleWebApp: { capable: true, title: "Lexigotchi", statusBarStyle: "default" },
  openGraph: {
    title: "Lexigotchi",
    description: "Raise your letters. Spell your words. Own the dictionary.",
    url: SITE_URL,
    siteName: "Lexigotchi",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body min-h-screen">{children}</body>
    </html>
  );
}
