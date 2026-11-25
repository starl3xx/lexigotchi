/**
 * SHOP_ENABLED (decisions.md #22): the Shop shows only where `NEXT_PUBLIC_SHOP_ENABLED=true`, on a
 * test network, with the Shop and USDC in this network's registry. Off by default, and off on mainnet
 * whatever the setting says (lib/shop/rules.ts `shopOn`). NEXT_PUBLIC so the client and the server
 * read the same value; it's inlined at build, so changing it needs a redeploy.
 */
import { NETWORK } from "@/lib/onchain/network";
import { shopAddress, usdcAddress } from "@/lib/onchain/addresses";
import { shopOn } from "./rules";

export function shopEnabled(): boolean {
  return shopOn({
    flag: process.env.NEXT_PUBLIC_SHOP_ENABLED,
    isTestnet: NETWORK.isTestnet,
    shop: shopAddress(),
    usdc: usdcAddress(),
  });
}

/** Test USDC exists only on a test network with MockUSDC in the registry. */
export function testUsdcFaucetOn(): boolean {
  return NETWORK.isTestnet && !!usdcAddress();
}
