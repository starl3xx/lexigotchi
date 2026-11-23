"use client";
/** A player as other players see them: Farcaster picture and @name, or a short wallet address. */
import type { PublicProfile } from "@/lib/neynar";
import { shortAddress } from "./useWorld";

export function PlayerChip({
  address,
  profile,
  you = false,
  size = 22,
}: {
  address: string;
  profile?: PublicProfile;
  you?: boolean;
  size?: number;
}) {
  const label = profile ? `@${profile.username}` : shortAddress(address);
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5" title={address}>
      {profile?.pfpUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={profile.pfpUrl} alt="" width={size} height={size} className="shrink-0 rounded-full border-2 border-ink object-cover" style={{ width: size, height: size }} />
      ) : (
        <span
          aria-hidden
          className="shrink-0 rounded-full border-2 border-ink bg-paper-dark"
          style={{ width: size, height: size, background: `hsl(${parseInt(address.slice(2, 8), 16) % 360} 45% 75%)` }}
        />
      )}
      <span className={`truncate ${profile ? "font-bold" : "font-mono text-[0.92em]"}`}>{label}</span>
      {you && <span className="shrink-0 rounded-full bg-teal px-1.5 text-[10px] font-extrabold uppercase text-paper">you</span>}
    </span>
  );
}
