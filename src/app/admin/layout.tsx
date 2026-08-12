import type { Metadata } from "next";
import { Providers } from "@/components/game/Providers";

export const metadata: Metadata = {
  title: "Lexigotchi · Operator",
  description: "Owner / operator console for Lexigotchi — metrics, economy, contract launch, and reward-pool funding.",
  robots: { index: false, follow: false },
};

/**
 * Admin area. Wraps the operator console in the shared providers — Farcaster (viewer identity) AND
 * wagmi (the connected wallet the gate now allowlists on). Scoped to this route, not loaded
 * app-wide. Auth is enforced client-side by <AdminGate>.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <Providers>{children}</Providers>;
}
