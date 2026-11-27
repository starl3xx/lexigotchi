/**
 * Claim fees by rarity tier, read from the chain (decisions.md #60): every `Words.ClaimFeePaid`
 * since the suite's deploy block, summed per tier. The console's Treasury tab shows it.
 *
 * Only a Words deployed with the claim fee by rarity emits the event (the registry's `claimTiers`):
 * elsewhere the answer is null, never a table of zeros that would read as "nobody claimed".
 */
import { getAbiItem } from "viem";
import { TIERS, type Tier } from "@/lib/economy";
import { wordsAbi } from "./abis";
import { addressOf, deployBlock, wordsHaveClaimTiers } from "./addresses";
import { getLogsAdaptive } from "./logs";
import { getPublicClient, toWholeWord } from "./reads";

/** Claims made and $WORD paid, per tier and in all (whole $WORD). */
export interface ClaimRevenue {
  byTier: Record<Tier, { claims: number; word: number }>;
  claims: number;
  word: number;
}

/** One ClaimFeePaid, as the sum needs it: the tier's number (0 Common … 4 Mythic) and the fee in wei. */
export interface FeePaid {
  tier: number;
  fee: bigint;
}

/** Sum fees by tier. A tier number outside the five (impossible from Words) is left out. Pure. */
export function sumClaimRevenue(paid: readonly FeePaid[]): ClaimRevenue {
  const byTier = Object.fromEntries(TIERS.map((t) => [t.name, { claims: 0, wei: 0n }])) as Record<Tier, { claims: number; wei: bigint }>;
  for (const p of paid) {
    const t = TIERS[p.tier]?.name;
    if (!t) continue;
    byTier[t].claims += 1;
    byTier[t].wei += p.fee;
  }
  let claims = 0;
  let wei = 0n;
  const out = {} as Record<Tier, { claims: number; word: number }>;
  for (const t of TIERS) {
    const r = byTier[t.name];
    claims += r.claims;
    wei += r.wei;
    out[t.name] = { claims: r.claims, word: toWholeWord(r.wei) };
  }
  return { byTier: out, claims, word: toWholeWord(wei) };
}

const CLAIM_FEE_PAID = getAbiItem({ abi: wordsAbi, name: "ClaimFeePaid" });

/** Every claim fee since deploy, by tier. Null where this network's Words has no ladder. Throws on a failed read. */
export async function readClaimRevenue(): Promise<ClaimRevenue | null> {
  if (!wordsHaveClaimTiers()) return null;
  const logs = await getLogsAdaptive(getPublicClient(), { address: addressOf("words"), event: CLAIM_FEE_PAID, fromBlock: deployBlock() });
  return sumClaimRevenue(logs.map((l) => ({ tier: Number(l.args.tier), fee: l.args.fee as bigint })));
}
