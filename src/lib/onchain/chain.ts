/**
 * The viem chain object for the active network.
 *
 * Deliberately separate from `./wagmi`: that module is `"use client"` and pulls in the Farcaster
 * connector, but the read layer and the signer API routes run on the server and need the chain
 * without any of that. Both import from here, so they can't drift.
 */
import { base, baseSepolia, type Chain } from "viem/chains";
import { NETWORK } from "./network";

export const ACTIVE_CHAIN: Chain = NETWORK.id === baseSepolia.id ? baseSepolia : base;
export { base, baseSepolia };
