import type { Tier } from "@/lib/economy";
import { tierMarkPaths } from "@/lib/tierMark";

/**
 * A rarity's mark (lib/tierMark, decisions.md #28): a round bead for Common, then a stone with
 * three, four, five, and six corners. It always sits beside the tier's name, so it is decorative
 * (hidden from screen readers). Give it a `size` in pixels, or a class that sizes it (the card
 * back's `cb-gem` follows the plate's type). No hooks and no motion: it draws on the server too.
 */
export function TierMark({ tier, size, className }: { tier: Tier; size?: number; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" width={size} height={size} style={{ flex: "none" }} aria-hidden>
      {tierMarkPaths(tier).map((p, i) => (
        <path key={i} d={p.d} fill={p.fill} opacity={p.opacity} stroke={p.stroke} strokeWidth={p.strokeWidth} strokeLinejoin="round" />
      ))}
    </svg>
  );
}
