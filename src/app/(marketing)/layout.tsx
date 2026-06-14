import Link from "next/link";

const NAV = [
  { href: "/about", label: "About" },
  { href: "/characters", label: "Characters" },
  { href: "/lexidex", label: "Lexidex" },
  { href: "/economy", label: "Economy" },
  { href: "/play", label: "▶ Play" },
];

/** Chrome for the marketing/reference pages. The game (/play) renders full-bleed without this. */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <header className="border-b-[3px] border-ink bg-paper-dark/60">
        <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/about" className="font-display text-xl font-extrabold tracking-tight">
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
        Lexigotchi — Phase 0 prototype · spec v0.2 · $WORD on Base. Numbers are placeholders the
        tokenomics sim exists to set.
      </footer>
    </>
  );
}
