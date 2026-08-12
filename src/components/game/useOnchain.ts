"use client";
/**
 * The game's connection to the chain: wallet state, live reads, and the one send path.
 *
 * Sends go through `sendCallsAttributed` with the connector's raw EIP-1193 provider, never wagmi's
 * write hooks — those would omit the ERC-8021 builder suffix and silently forfeit Base builder
 * rewards (the transaction still succeeds, which is what makes it easy to miss).
 *
 * Reads are react-query so the UI gets caching, refetch-on-focus, and a single invalidation point
 * after a send. Params are shared across players and move rarely; player state is per-wallet and
 * moves constantly, so they're separate queries with different staleness.
 */
import { useCallback, useMemo } from "react";
import { useAccount, useConnect } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { sendCallsAttributed, type Call, type Eip1193Provider, type SendResult } from "@/lib/onchain/sendCalls";
import { readGameParams, readPlayerState, type GameParams, type PlayerState } from "@/lib/onchain/reads";
import { isSuiteDeployed } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";

/** Params are global and only move on a repeg — a minute of staleness is fine. */
const PARAMS_STALE_MS = 60_000;
/** Player state changes with every action; keep it tight so buttons don't lie. */
const PLAYER_STALE_MS = 5_000;

export interface OnchainState {
  address?: `0x${string}`;
  isConnected: boolean;
  /** True when the suite has addresses on this network — the gate for showing on-chain UI at all. */
  deployed: boolean;
  isTestnet: boolean;
  networkName: string;
  params?: GameParams;
  player?: PlayerState;
  loading: boolean;
  error?: string;
  connect: () => void;
  /** Send a batch through the attributed chokepoint, then refresh reads. */
  send: (calls: Call[]) => Promise<SendResult>;
  refresh: () => Promise<void>;
}

export function useOnchain(): OnchainState {
  const { address, isConnected, connector } = useAccount();
  const { connect, connectors } = useConnect();
  const qc = useQueryClient();
  const deployed = useMemo(() => isSuiteDeployed(), []);

  const paramsQ = useQuery({
    queryKey: ["gameParams", NETWORK.id],
    queryFn: readGameParams,
    enabled: deployed,
    staleTime: PARAMS_STALE_MS,
  });

  const playerQ = useQuery({
    queryKey: ["playerState", NETWORK.id, address],
    queryFn: () => readPlayerState(address as `0x${string}`),
    enabled: deployed && !!address,
    staleTime: PLAYER_STALE_MS,
  });

  const refresh = useCallback(async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["gameParams", NETWORK.id] }),
      qc.invalidateQueries({ queryKey: ["playerState", NETWORK.id, address] }),
    ]);
  }, [qc, address]);

  const send = useCallback(
    async (calls: Call[]) => {
      if (!address) throw new Error("Connect a wallet first.");
      if (!connector?.getProvider) throw new Error("This connector exposes no EIP-1193 provider.");
      const provider = (await connector.getProvider()) as Eip1193Provider;
      const result = await sendCallsAttributed(provider, address, calls);
      // The batch is not atomic, so an approval can land while the action fails. Never trust the
      // intended end state — re-read it.
      await refresh();
      return result;
    },
    [address, connector, refresh],
  );

  const doConnect = useCallback(() => {
    // The mini-app connector is first in the config and auto-connects inside a Farcaster client;
    // this is the explicit fallback for the web.
    const target = connectors[0];
    if (target) connect({ connector: target });
  }, [connect, connectors]);

  return {
    address,
    isConnected,
    deployed,
    isTestnet: NETWORK.isTestnet,
    networkName: NETWORK.name,
    params: paramsQ.data,
    player: playerQ.data,
    loading: paramsQ.isLoading || playerQ.isLoading,
    error: (paramsQ.error as Error | null)?.message ?? (playerQ.error as Error | null)?.message,
    connect: doConnect,
    send,
    refresh,
  };
}
