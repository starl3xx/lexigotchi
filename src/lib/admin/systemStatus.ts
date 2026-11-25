/**
 * The System tab: what this deployment is and holds, in one read. Which game runs, every server key
 * (as its public address, its gas, and whether the contracts point at it), whether the daily keeper
 * is keeping up, every feature switch, and which database migrations are applied. Server-only, and
 * served behind the admin gate (lib/admin/serverAuth.ts): it names the keys and switches this
 * deployment has, which is a map for anyone probing it.
 *
 * Every chain or database read here is allowed to fail on its own; the tab shows what it got.
 */
import { formatEther } from "viem";
import journal from "../../../drizzle/meta/_journal.json";
import { getPublicClient, readChainTime } from "@/lib/onchain/reads";
import { isSuiteDeployed, maybeAddressOf } from "@/lib/onchain/addresses";
import { NETWORK } from "@/lib/onchain/network";
import { isChainBacked, isRealEconomy } from "@/lib/onchain/gameMode";
import { answerChainAbi, jackpotAbi, lettersAbi } from "@/lib/onchain/abis";
import { isCampaignConfigured } from "@/lib/db/client";
import { schemaState } from "@/lib/db/adminReads";
import { jobsFrom } from "@/lib/keeper/jobList";
import { serverKeys, type ServerKeyRole } from "./serverKeys";
import { featureSwitches, type Switch } from "./switches";

export interface KeyStatus {
  role: ServerKeyRole;
  env: string;
  configured: boolean;
  address: string | null;
  error: string | null;
  /** What it's for, in one line. */
  job: string;
  /** Sends transactions, so it needs ETH for gas. */
  sends: boolean;
  balanceEth: number | null;
  /** The address the contracts expect for this role, when the role exists onchain. */
  onchain: string | null;
  /** True/false once both are known; null when there is nothing to compare. */
  wired: boolean | null;
}

export interface MigrationStatus {
  tag: string;
  applied: boolean | null;
}

export interface SystemPayload {
  ok: true;
  at: number;
  network: { id: number; name: string; isTestnet: boolean; explorer: string };
  game: { chainBacked: boolean; suiteDeployed: boolean; brake: boolean; realEconomy: boolean };
  keys: KeyStatus[];
  keeper: {
    jobs: string[] | null;
    jobsError: string | null;
    answerSeed: boolean;
    answerDays: number | null;
    /**
     * Today's chain day (UTC days since the epoch) and the jackpot's last resolved day (the day of
     * the run; 0 = never). `answerReveals` is AnswerChain.revealedDay, which despite its name counts
     * reveals (1, 2, 3…), one per resolve: it is not a day.
     */
    chainDay: number | null;
    jackpotResolvedDay: number | null;
    answerReveals: number | null;
  };
  switches: Switch[];
  database: {
    configured: boolean;
    reachable: boolean;
    tables: string[];
    migrations: MigrationStatus[];
  };
}

const KEY_JOBS: Record<ServerKeyRole, { job: string; sends: boolean }> = {
  signer: { job: "Signs letter draws, roll and prestige outcomes, and daily vouchers. Sends nothing.", sends: false },
  relayer: { job: "Finishes every roll on the server (Rolls.reveal), so the wallet never previews the result.", sends: true },
  keeper: { job: "The daily cron: resolves the jackpot, opens yield and bounty epochs, and pays every share out.", sends: true },
  priceKeeper: { job: "Moves the onchain prices toward their USD targets (repeg).", sends: true },
};

async function keyStatuses(): Promise<KeyStatus[]> {
  const keys = serverKeys();
  const client = isSuiteDeployed() ? getPublicClient() : null;
  const letters = maybeAddressOf("letters");
  const jackpot = maybeAddressOf("jackpot");
  const wiredTo = async (role: ServerKeyRole): Promise<string | null> => {
    if (!client) return null;
    try {
      if (role === "signer" && letters) return String(await client.readContract({ address: letters, abi: lettersAbi, functionName: "signer" })).toLowerCase();
      if (role === "priceKeeper" && letters)
        return String(await client.readContract({ address: letters, abi: lettersAbi, functionName: "priceKeeper" })).toLowerCase();
      if (role === "keeper" && jackpot) return String(await client.readContract({ address: jackpot, abi: jackpotAbi, functionName: "keeper" })).toLowerCase();
    } catch {
      return null;
    }
    return null; // the relayer has no onchain role: anyone may send a signed reveal
  };
  return Promise.all(
    keys.map(async (k) => {
      const { job, sends } = KEY_JOBS[k.role];
      const [onchain, balance] = await Promise.all([
        wiredTo(k.role),
        sends && k.address && client
          ? client.getBalance({ address: k.address }).then((b) => Number(formatEther(b))).catch(() => null)
          : Promise.resolve(null),
      ]);
      return {
        role: k.role,
        env: k.env,
        configured: k.configured,
        address: k.address,
        error: k.error,
        job,
        sends,
        balanceEth: balance,
        onchain,
        wired: onchain && k.address ? onchain === k.address : null,
      };
    }),
  );
}

async function keeperProgress(): Promise<Pick<SystemPayload["keeper"], "chainDay" | "jackpotResolvedDay" | "answerReveals">> {
  const none = { chainDay: null, jackpotResolvedDay: null, answerReveals: null };
  if (!isSuiteDeployed()) return none;
  const client = getPublicClient();
  const jackpot = maybeAddressOf("jackpot");
  const answer = maybeAddressOf("answerChain");
  const [now, resolved, revealed] = await Promise.all([
    readChainTime().catch(() => null),
    jackpot ? client.readContract({ address: jackpot, abi: jackpotAbi, functionName: "lastResolvedDay" }).catch(() => null) : null,
    answer ? client.readContract({ address: answer, abi: answerChainAbi, functionName: "revealedDay" }).catch(() => null) : null,
  ]);
  return {
    chainDay: now == null ? null : Math.floor(now / 86_400),
    jackpotResolvedDay: resolved == null ? null : Number(resolved),
    answerReveals: revealed == null ? null : Number(revealed),
  };
}

async function databaseStatus(): Promise<SystemPayload["database"]> {
  const entries = (journal as { entries: { tag: string; when: number }[] }).entries;
  if (!isCampaignConfigured()) {
    return { configured: false, reachable: false, tables: [], migrations: entries.map((e) => ({ tag: e.tag, applied: null })) };
  }
  try {
    const { tables, appliedThrough } = await schemaState();
    return {
      configured: true,
      reachable: true,
      tables,
      migrations: entries.map((e) => ({ tag: e.tag, applied: appliedThrough == null ? null : e.when <= appliedThrough })),
    };
  } catch {
    return { configured: true, reachable: false, tables: [], migrations: entries.map((e) => ({ tag: e.tag, applied: null })) };
  }
}

export async function loadSystem(): Promise<SystemPayload> {
  let jobs: string[] | null = null;
  let jobsError: string | null = null;
  try {
    jobs = jobsFrom(process.env.KEEPER_JOBS);
  } catch (err) {
    jobsError = (err as Error).message.slice(0, 160);
  }
  const days = Number(process.env.ANSWER_CHAIN_DAYS);
  const [keys, progress, database] = await Promise.all([keyStatuses(), keeperProgress(), databaseStatus()]);
  return {
    ok: true,
    at: Date.now(),
    network: { id: NETWORK.id, name: NETWORK.name, isTestnet: NETWORK.isTestnet, explorer: NETWORK.explorer },
    game: {
      chainBacked: isChainBacked(),
      suiteDeployed: isSuiteDeployed(),
      brake: process.env.NEXT_PUBLIC_CHAIN_GAME === "0",
      realEconomy: isRealEconomy(),
    },
    keys,
    keeper: {
      jobs,
      jobsError,
      answerSeed: Boolean(process.env.ANSWER_CHAIN_SEED?.trim()),
      answerDays: Number.isFinite(days) && days > 0 ? days : null,
      ...progress,
    },
    switches: featureSwitches(),
    database,
  };
}
