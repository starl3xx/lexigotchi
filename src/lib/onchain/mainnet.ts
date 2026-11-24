import { createPublicClient } from "viem";
import { base } from "viem/chains";
import { rpcTransport } from "./transport";

/**
 * A Base MAINNET client, whatever NETWORK says. For reads about things that exist only on mainnet:
 * the real $WORD token (its supply and burns, a holder's balance) and Coinbase's attestations. The
 * game's own reads follow NETWORK (Sepolia on a testnet build); these must not.
 *
 * Server-side only: rpcTransport stamps our Origin, which an allowlisted Alchemy key requires.
 */
function makeMainnetClient() {
  return createPublicClient({
    chain: base,
    transport: rpcTransport(process.env.BASE_MAINNET_RPC_URL || "https://mainnet.base.org"),
  });
}
let mainnet: ReturnType<typeof makeMainnetClient> | undefined;
export function getMainnetClient() {
  return (mainnet ??= makeMainnetClient());
}
