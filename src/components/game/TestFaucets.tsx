"use client";
/**
 * The test network's two faucets, side by side wherever test $WORD is offered (decisions.md #22):
 * Get test $WORD (MockERC20's open mint) and Get test USDC (MockUSDC, 25 a profile a day, vouched by
 * the server). Both wait for the mint itself and say plainly what went wrong (ChainGameProvider
 * `runFaucet`). Nothing here exists on mainnet: the caller renders it only on a test network, and
 * the USDC button only where MockUSDC is in the registry. Test USDC never shows as dollars.
 */
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Button } from "./primitives";
import { Plus } from "./ui/icons";
import { useGame } from "./state";
import { useOpenUrl } from "./useShare";
import { erc20Abi } from "@/lib/onchain/abis";
import { getPublicClient } from "@/lib/onchain/reads";
import { usdcAddress } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { BASE_SEPOLIA_FAUCETS_URL } from "@/lib/site";
import { testUsdcFaucetOn } from "@/lib/shop/config";
import { usdcLabel } from "@/lib/shop/rules";

/** The connected wallet's test USDC, or undefined while unknown (null where there is none to read). */
export function useTestUsdcBalance() {
  const { address } = useAccount();
  const usdc = usdcAddress();
  return useQuery({
    queryKey: ["shop", "usdc", address],
    enabled: !!address && !!usdc && NETWORK.isTestnet,
    staleTime: 10_000,
    queryFn: async () =>
      (await getPublicClient().readContract({ address: usdc!, abi: erc20Abi, functionName: "balanceOf", args: [address!] })) as bigint,
  });
}

export function TestFaucets({ size = "lg" }: { size?: "md" | "lg" }) {
  const g = useGame();
  const openUrl = useOpenUrl();
  const usdcOn = testUsdcFaucetOn();
  const usdcBal = useTestUsdcBalance();
  if (!NETWORK.isTestnet || !g.state.chainBacked) return null;
  return (
    <div>
      {/* The test game's way to get $WORD, so it is the main action. A faucet is a transaction like
          any other: a plain wallet pays its gas, a sponsored one doesn't. */}
      <div className={usdcOn ? "grid grid-cols-2 gap-2" : ""}>
        <Button full size={size} variant="teal" onClick={g.addDemoBalance}>
          <Plus weight="bold" /> Get test $WORD
        </Button>
        {usdcOn && (
          <Button
            full
            size={size}
            variant="teal"
            onClick={() => void g.getTestUsdc().then((ok) => ok && void usdcBal.refetch())}
          >
            <Plus weight="bold" /> Get test USDC
          </Button>
        )}
      </div>
      {usdcOn && usdcBal.data !== undefined && (
        <p className="mt-1.5 text-center text-xs text-ink/60">You have {usdcLabel(usdcBal.data, true)}, for the Shop.</p>
      )}
      <p className="mt-1.5 text-center text-xs text-ink/55">
        Free from the testnet faucets{usdcOn ? " (test USDC: 25 a day)" : ""}. If your wallet pays its own gas, it needs a
        little {NETWORK.name} ETH.{" "}
        <button onClick={() => void openUrl(BASE_SEPOLIA_FAUCETS_URL)} className="font-bold underline">
          Get some free
        </button>
      </p>
    </div>
  );
}
