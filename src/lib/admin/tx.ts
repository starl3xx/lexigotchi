/**
 * Transaction-plan model for the admin dashboard.
 *
 * Phase 0 (contracts not yet deployed) every operator action is built into a structured `TxIntent`
 * and rendered two ways the owner can act on immediately:
 *   - a `cast send` command (Foundry — the same toolchain the deploy uses), and
 *   - a Gnosis Safe Transaction Builder JSON batch (the right path for a multisig owner).
 * When the suite is deployed and a wallet layer is added, the same `TxIntent` drives in-browser
 * execution. No ABI encoding is done here — `cast` and Safe both take the human signature + values.
 */
import type { ContractKey } from "./deployments";
import { isAddress, isBytes32 } from "./format";
import { NETWORK } from "@/lib/onchain/network";

export interface TxArgValue {
  name: string;
  type: string;
  value: string;
  /** Tuple components, for Safe JSON (value is rendered as "(a,b,c,d)"). */
  components?: { name: string; type: string }[];
}

export interface TxIntent {
  /** Registry key, or a free label for off-registry targets (e.g. the $WORD token). */
  contractKey: ContractKey | string;
  contractName: string;
  /** Target address, if the suite is deployed. */
  address?: string | null;
  signature: string;
  fn: string;
  args: TxArgValue[];
  /** ETH value in wei (almost always "0"). */
  value?: string;
  /** Human note shown above the command. */
  note?: string;
}

/** Validate an intent's argument values. Returns a list of human errors ([] = ready). */
export function validateIntent(intent: TxIntent): string[] {
  const errs: string[] = [];
  for (const a of intent.args) {
    const v = a.value?.trim() ?? "";
    // Empty is invalid for everything except a string (e.g. setURI("") is a legitimate call).
    if (v === "" && a.type !== "string") {
      errs.push(`${a.name} is required`);
      continue;
    }
    if (a.type === "address") {
      if (!isAddress(v)) errs.push(`${a.name} must be a 0x address`);
    } else if (a.type === "bytes32") {
      if (!isBytes32(v)) errs.push(`${a.name} must be 32 bytes (0x + 64 hex)`);
    } else if (a.type === "bool") {
      if (v !== "true" && v !== "false") errs.push(`${a.name} must be true or false`);
    } else if (a.type.startsWith("uint")) {
      if (!/^\d+$/.test(v)) {
        errs.push(`${a.name} must be a whole number`);
      } else {
        // Width-aware bound so an out-of-range value is caught here, not at encode/execute time.
        const bits = Number(a.type.slice(4)) || 256;
        if (BigInt(v) >= 1n << BigInt(bits)) errs.push(`${a.name} exceeds ${a.type} max`);
      }
    } else if (a.type.startsWith("(")) {
      // tuple "(a,b,c,d)" — each component a whole number for our split tuples
      const parts = v.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim());
      if (a.components && parts.length !== a.components.length) {
        errs.push(`${a.name} needs ${a.components.length} values`);
      } else if (parts.some((p) => !/^\d+$/.test(p))) {
        errs.push(`${a.name} values must be whole numbers`);
      } else if (a.components && a.components.every((c) => c.type === "uint16")) {
        // FeeRouter Split: each share ≤ 10000 bps and the four must sum to exactly 10000.
        const nums = parts.map(Number);
        if (nums.some((n) => n > 10_000)) errs.push(`${a.name} values must each be ≤ 10000 bps`);
        else if (nums.reduce((x, y) => x + y, 0) !== 10_000) errs.push(`${a.name} must sum to 10000 bps`);
      }
    }
  }
  return errs;
}

function castArg(a: TxArgValue): string {
  const v = a.value.trim();
  // Single-quote strings and tuple literals so shell metacharacters — the tuple's parens, or a
  // `$`/backtick inside a string — reach cast verbatim instead of being interpreted by the shell.
  if (a.type === "string" || a.type.startsWith("(")) return `'${v.replace(/'/g, "'\\''")}'`;
  return v; // address / uint / bytes32 / bool are shell-safe
}

/** Render a copy-pasteable `cast send` command. */
export function castCommand(intent: TxIntent): string {
  // Shell-safe placeholder (an env-var ref) when the address is missing/empty/invalid — never a
  // literal `<…>` and never an empty `""` that would render as a real (broken) target.
  const target =
    intent.address && isAddress(intent.address)
      ? intent.address
      : `$${intent.contractName.replace(/[^A-Za-z0-9]/g, "").toUpperCase()}_ADDR`;
  const args = intent.args.map(castArg).join(" ");
  const valueFlag = intent.value && intent.value !== "0" ? ` --value ${intent.value}` : "";
  const body = `cast send ${target} "${intent.signature}"${args ? " " + args : ""}${valueFlag}`;
  return `${body} \\\n  --rpc-url "$BASE_RPC" --account operator`;
}

function safeTransaction(intent: TxIntent) {
  const inputs = intent.args.map((a) => {
    if (a.type.startsWith("(") && a.components) {
      return {
        name: a.name,
        type: "tuple",
        internalType: `struct ${intent.contractName}.Split`,
        components: a.components.map((c) => ({ name: c.name, type: c.type, internalType: c.type })),
      };
    }
    return { name: a.name, type: a.type, internalType: a.type };
  });
  const contractInputsValues: Record<string, string> = {};
  for (const a of intent.args) {
    if (a.type.startsWith("(")) {
      const parts = a.value.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim());
      contractInputsValues[a.name] = JSON.stringify(parts);
    } else {
      contractInputsValues[a.name] = a.value.trim();
    }
  }
  return {
    to: intent.address && isAddress(intent.address) ? intent.address : "<set the deployed address>",
    value: intent.value ?? "0",
    data: null,
    contractMethod: { inputs, name: intent.fn, payable: !!intent.value && intent.value !== "0" },
    contractInputsValues,
  };
}

/** Render a Safe Transaction Builder batch JSON for one or more intents. */
export function safeBatchJson(
  intents: TxIntent[],
  meta: { name: string; description?: string },
  chainId = NETWORK.id,
): string {
  const batch = {
    version: "1.0",
    chainId: String(chainId),
    createdAt: Date.now(),
    meta: { name: meta.name, description: meta.description ?? "", txBuilderVersion: "1.18.0" },
    transactions: intents.map(safeTransaction),
  };
  return JSON.stringify(batch, null, 2);
}
