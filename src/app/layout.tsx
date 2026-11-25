import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_URL ?? "https://lexigotchi.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  // The messaging guide's title and share description (docs/messaging.md, decisions.md #23).
  title: "Lexigotchi: a word-pet game on Base",
  description: "Collect letters, raise them, and spell words only you can own.",
  // Tab icon + Home Screen icon. There was no favicon at all (every page load 404'd /favicon.ico).
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  // iPhone/iPad: a Home Screen launch opens full-screen, which is where iOS allows browser push.
  appleWebApp: { capable: true, title: "Lexigotchi", statusBarStyle: "default" },
  openGraph: {
    title: "Lexigotchi: a word-pet game on Base",
    description: "Collect letters, raise them, and spell words only you can own.",
    url: SITE_URL,
    siteName: "Lexigotchi",
    // The branded 1200×800 PNG card the mini-app embed already uses (og:image must be PNG/JPG).
    images: [{ url: "/embed-image", width: 1200, height: 800, alt: "Lexigotchi" }],
  },
  twitter: { card: "summary_large_image", site: "@lexigotchi" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="motion-safe:scroll-smooth">
      <body className="font-body min-h-screen">{children}</body>
    </html>
  );
}
