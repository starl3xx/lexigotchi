import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Lexigotchi — raise your letters, spell your words, own the dictionary",
  description:
    "A tamagotchi-style collection game for the $WORD / Let's Have A Word! ecosystem on Base. Phase 0 prototype.",
};

const NAV = [
  { href: "/", label: "Home" },
  { href: "/characters", label: "Characters" },
  { href: "/lexidex", label: "Lexidex" },
  { href: "/economy", label: "Economy" },
  { href: "/play", label: "▶ Play" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="font-body min-h-screen">
        <header className="border-b-[3px] border-ink bg-paper-dark/60">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link href="/" className="font-display text-xl font-extrabold tracking-tight">
              LEXIGOTCHI
            </Link>
            <div className="flex items-center gap-1 text-sm font-semibold">
              {NAV.map((n) =>
                n.href === "/play" ? (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="rounded-lg border-2 border-ink bg-candy px-3 py-1.5 font-bold text-paper shadow-[2px_2px_0_#1b1714] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none"
                  >
                    {n.label}
                  </Link>
                ) : (
                  <Link key={n.href} href={n.href} className="rounded px-3 py-1.5 hover:bg-tile">
                    {n.label}
                  </Link>
                ),
              )}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
        <footer className="mx-auto max-w-5xl px-4 py-10 text-xs text-ink/60">
          Lexigotchi — Phase 0 prototype · spec v0.2 · $WORD on Base. Numbers are
          placeholders the tokenomics sim exists to set.
        </footer>
      </body>
    </html>
  );
}
