"use client";
/**
 * Launch — the contract deployment console. Deployment is a single `forge script Deploy` run (it
 * deploys + wires all 10 contracts and seeds the v0.2 fee splits), driven by env vars. This tab
 * collects every var the script reads, picks the signing mode, generates the exact command + export
 * block, and captures the printed addresses back into the deployment registry. Executes nothing
 * here — you run forge with your deployer key.
 *
 * Prices are emitted explicitly rather than left to `Deploy.s.sol`'s built-in defaults: those are a
 * frozen peg snapshot, and $WORD moves. The fields prefill from the live peg (params.ts) in whole
 * $WORD and are exported as wei.
 */
import { useState } from "react";
import { CONTRACTS } from "@/lib/admin/contracts";
import {
  loadDeployments,
  saveDeployments,
  CONTRACT_KEYS,
  type ContractKey,
} from "@/lib/admin/deployments";
import { DEFAULT_PARAMS } from "@/lib/params";
import {
  fmtUsd,
  fmtWordCompact,
  isAddress,
  isBytes32,
  shortAddr,
  usdToWord,
  wholeWordToWei,
} from "@/lib/admin/format";
import economy from "../../../../contracts/config/economy.json";
import { AdminCard, Banner, CopyButton, Field, SectionLabel, Select, TextField } from "../ui";
import { Check, Database, Info, ListChecks, RocketLaunch, Warning } from "../icons";

/** `word` = entered in whole $WORD, exported as 18-decimal wei. */
type FieldType = "address" | "bytes32" | "text" | "uint" | "word";

interface EnvField {
  key: string;
  label: string;
  group: string;
  required?: boolean;
  type?: FieldType;
  default?: string;
  help?: string;
}

const P = DEFAULT_PARAMS.prices;
/** Whole-$WORD price at the live peg (the field unit). */
const peg = (usd: number) => String(Math.round(usdToWord(usd)));
const pegHint = (usd: number) => `${fmtUsd(usd)} · ${fmtWordCompact(usdToWord(usd))} $WORD`;

const G = {
  keys: "Network & signing",
  roles: "Roles & wiring",
  prices: "Prices — emitted at today's peg",
  care: "Care & prestige",
  repeg: "Repeg keeper",
  meta: "Metadata & economics",
} as const;

const ENV: EnvField[] = [
  // --- network -----------------------------------------------------------------------------------
  { key: "BASE_RPC", label: "Base RPC URL", group: G.keys, required: true, type: "text", help: "Base mainnet endpoint" },
  { key: "ETHERSCAN_API_KEY", label: "Basescan API key", group: G.keys, type: "text", help: "required by --verify" },

  // --- roles -------------------------------------------------------------------------------------
  { key: "TREASURY", label: "Treasury", group: G.roles, required: true, type: "address", help: "receives treasury splits + royalty signal" },
  { key: "SIGNER", label: "Signer", group: G.roles, required: true, type: "address", help: "backend key (draws / rolls / prestige)" },
  { key: "KEEPER", label: "Keeper", group: G.roles, required: true, type: "address", help: "operator key (resolve / epochs)" },
  { key: "ANSWERCHAIN_HEAD", label: "AnswerChain head", group: G.roles, required: true, type: "bytes32", help: "from npm run answerchain:generate" },
  { key: "WORD_TOKEN", label: "$WORD token", group: G.roles, type: "address", default: "0x304e649e69979298bd1aee63e175adf07885fb4b" },
  { key: "SWAP_ROUTER", label: "Swap router", group: G.roles, type: "address", help: "ETH→$WORD adapter; blank = disabled" },

  // --- prices (whole $WORD in, wei out) ------------------------------------------------------------
  { key: "PACK_PRICE", label: "Pack price", group: G.prices, type: "word", default: peg(P.pack), help: pegHint(P.pack) },
  { key: "DAILY_PRICE", label: "Daily single", group: G.prices, type: "word", default: "0", help: "FREE + FID-gated — keep 0" },
  { key: "ROLL_PRICE", label: "Roll price", group: G.prices, type: "word", default: peg(P.roll), help: pegHint(P.roll) },
  { key: "CLAIM_PRICE", label: "Claim price", group: G.prices, type: "word", default: peg(P.claim), help: pegHint(P.claim) },
  { key: "SNACK_PRICE", label: "Snack price", group: G.prices, type: "word", default: peg(P.snack), help: pegHint(P.snack) },
  { key: "PRESTIGE_FEE", label: "Prestige fee", group: G.prices, type: "word", default: peg(P.roll), help: pegHint(P.roll) },

  // --- care --------------------------------------------------------------------------------------
  { key: "PECKISH_AFTER", label: "Peckish after", group: G.care, type: "uint", default: "86400", help: "seconds unfed → ½ yield" },
  { key: "HUNGRY_AFTER", label: "Hungry after", group: G.care, type: "uint", default: "259200", help: "seconds → 0 yield, no jackpot" },
  { key: "PRESTIGE_MAX_LEVEL", label: "Prestige max level", group: G.care, type: "uint", default: "4" },

  // --- repeg -------------------------------------------------------------------------------------
  { key: "PRICE_KEEPER", label: "Price keeper", group: G.repeg, type: "address", help: "blank = auto-repeg disabled (freeze default)" },
  { key: "MAX_MOVE_BPS", label: "Repeg band (bps)", group: G.repeg, type: "uint", default: "2000", help: "±20% per repeg call" },

  // --- metadata ----------------------------------------------------------------------------------
  { key: "WORDS_URI", label: "Words base URI", group: G.meta, type: "text", help: "e.g. https://lexigotchi.fun/api/word/" },
  { key: "LETTERS_URI", label: "Letters metadata URI", group: G.meta, type: "text", help: "ERC-1155 URI" },
  { key: "ROYALTY_BPS", label: "Royalty signal (bps)", group: G.meta, type: "uint", default: "250", help: "EIP-2981 signal; 0 = skip" },
  { key: "BOUNTY_CARVE_BPS", label: "Bounty carve (bps)", group: G.meta, type: "uint", default: "0", help: "0 = bounty off" },
];

const GROUP_ORDER = [G.keys, G.roles, G.prices, G.care, G.repeg, G.meta];

type SignMode = "ledger" | "account" | "key";

const SIGN_MODES: { value: SignMode; label: string }[] = [
  { value: "ledger", label: "Ledger (hardware)" },
  { value: "account", label: "Keystore account (cast wallet)" },
  { value: "key", label: "Raw private key (env)" },
];

/** Single-quote a shell literal (with the '\'' escape) so a quote, $, backtick, or space in a value
 *  can't split the string when the block is pasted. */
function shQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

const NAME_TO_KEY = new Map(CONTRACTS.map((c) => [c.name.toLowerCase(), c.key]));

/** Pull `Name  0x…` pairs out of a pasted `forge script` log (order-independent, name-matched). */
function parseAddresses(log: string): Partial<Record<ContractKey, string>> {
  const out: Partial<Record<ContractKey, string>> = {};
  for (const line of log.split("\n")) {
    const m = line.match(/\b([A-Za-z]+)\b\s*[:=]?\s+(0x[a-fA-F0-9]{40})\b/);
    if (!m) continue;
    const key = NAME_TO_KEY.get(m[1].toLowerCase());
    if (key) out[key] = m[2];
  }
  return out;
}

export function LaunchTab() {
  const [vals, setVals] = useState<Record<string, string>>(() =>
    Object.fromEntries(ENV.map((f) => [f.key, f.default ?? ""])),
  );
  const [sign, setSign] = useState<{ mode: SignMode; sender: string; account: string }>({
    mode: "ledger",
    sender: "",
    account: "lexi-deployer",
  });
  const [log, setLog] = useState("");
  const [imported, setImported] = useState(0);

  const set = (k: string, v: string) => setVals((p) => ({ ...p, [k]: v }));
  const val = (k: string) => (vals[k] ?? "").trim();

  const invalid = (f: EnvField) => {
    const v = val(f.key);
    if (v === "") return false;
    if (f.type === "address") return !isAddress(v);
    if (f.type === "bytes32") return !isBytes32(v);
    if (f.type === "uint" || f.type === "word") return !/^\d+$/.test(v);
    return false;
  };

  const needsSender = sign.mode !== "key";
  const missing = [
    ...ENV.filter((f) => f.required && !val(f.key)).map((f) => f.label),
    ...(needsSender && !isAddress(sign.sender) ? ["Deployer address"] : []),
  ];
  const badFields = ENV.filter(invalid).map((f) => f.label);
  // A malformed price coerces to 0 wei, which forge would happily accept — free packs, forever. The
  // command is withheld entirely rather than handing over something that fails silently.
  const blocked = badFields.length > 0;
  // A literal 0 is valid input but means free. Only the daily single is meant to be.
  const zeroPrices = ENV.filter(
    (f) => f.type === "word" && f.key !== "DAILY_PRICE" && /^0+$/.test(val(f.key)),
  ).map((f) => f.label);

  const exportBlock = ENV.filter((f) => val(f.key) !== "")
    .map((f) => {
      const raw = f.type === "word" ? wholeWordToWei(val(f.key)) : val(f.key);
      const note = f.type === "word" ? `   # ${val(f.key)} $WORD` : "";
      return `export ${f.key}=${shQuote(raw)}${note}`;
    })
    .join("\n");

  // Trim before emitting: isAddress() validates the trimmed string, so a pasted address with stray
  // whitespace passes the required check and would otherwise land verbatim in --sender.
  const sender = sign.sender.trim() || "0xYOUR_DEPLOYER";
  const account = sign.account.trim() || "lexi-deployer";
  const signFlags =
    sign.mode === "ledger"
      ? `--ledger --sender ${sender}`
      : sign.mode === "account"
        ? `--account ${shQuote(account)} --sender ${sender}`
        : '--private-key "$DEPLOYER_PK"';

  const command = [
    "# 0 · pre-flight (repo root)",
    "npm run answerchain:generate   # ONE TIME — secret + irreplaceable, back it up offline",
    "npm run derive:contracts       # per-letter caps + dictionary root → config/economy.json",
    "npm run contracts:setup        # one-time: vendor forge-std + OpenZeppelin",
    "npm run contracts:test         # 54 forge tests must be green",
    "",
    "# 1 · env",
    exportBlock || "# (fill the required fields above)",
    "",
    "# 2 · deploy + wire all 10 contracts, seed the v0.2 splits (forge runs from contracts/)",
    "cd contracts && forge script script/Deploy.s.sol:Deploy \\",
    '  --rpc-url "$BASE_RPC" \\',
    "  --broadcast --verify \\",
    `  ${signFlags}`,
  ].join("\n");

  // --- post-deploy address capture ---------------------------------------------------------------
  const parsed = parseAddresses(log);
  const parsedCount = CONTRACT_KEYS.filter((k) => parsed[k]).length;

  const saveToRegistry = () => {
    const cur = loadDeployments();
    const roles = { ...cur.roles };
    if (isAddress(val("TREASURY"))) roles.treasury = val("TREASURY");
    if (isAddress(val("SIGNER"))) roles.signer = val("SIGNER");
    if (isAddress(val("KEEPER"))) roles.keeper = val("KEEPER");
    saveDeployments({
      ...cur,
      wordToken: isAddress(val("WORD_TOKEN")) ? val("WORD_TOKEN") : cur.wordToken,
      deployedAt: new Date().toISOString().slice(0, 10),
      roles,
      contracts: { ...cur.contracts, ...parsed },
    });
    window.dispatchEvent(new Event("lexi:deployments"));
    setImported(parsedCount);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <RocketLaunch weight="bold" size={18} />
        <h2 className="font-display text-lg font-extrabold">Launch</h2>
      </div>

      <Banner tone="warning" icon={<Info weight="bold" size={14} />}>
        The suite is <strong>code-complete and tested but not yet audited or deployed</strong>. Deployment is one
        <code> forge script</code> run from your deployer key — this console assembles its inputs and walks the steps.
      </Banner>

      <AdminCard title="Deploy configuration">
        {GROUP_ORDER.map((g) => (
          <div key={g} className="mb-4 last:mb-0">
            <SectionLabel>{g}</SectionLabel>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {ENV.filter((f) => f.group === g).map((f) => (
                <Field
                  key={f.key}
                  label={
                    <>
                      {f.label}
                      {f.required && <span className="text-candy"> *</span>}
                    </>
                  }
                  hint={f.help}
                >
                  <TextField
                    value={vals[f.key] ?? ""}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={f.type === "word" ? "whole $WORD" : (f.type ?? "value")}
                    invalid={invalid(f)}
                  />
                </Field>
              ))}
            </div>
          </div>
        ))}
        <p className="mt-2 text-[11px] text-ink/45">
          Price fields are entered in <strong>whole $WORD</strong> and exported as wei — prefilled from the live peg
          ({fmtWordCompact(usdToWord(1))} $WORD to the dollar). Emit them explicitly: the script&apos;s built-in
          defaults are a frozen snapshot and will be stale by launch. Per-letter caps ({economy.caps.length} ids,{" "}
          {economy.totalSupplyCap.toLocaleString()} total) and the dictionary root (
          <span className="font-mono">{economy.dictionaryRoot.slice(0, 12)}…</span>) are read from{" "}
          <code>config/economy.json</code> by the script — not env.
        </p>
      </AdminCard>

      <AdminCard title="Deployer key">
        <SectionLabel>how forge signs the deploy — the suite&apos;s first owner</SectionLabel>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Signing mode" hint="hardware is the launch posture">
            <Select
              value={sign.mode}
              onChange={(v) => setSign((p) => ({ ...p, mode: v as SignMode }))}
              options={SIGN_MODES}
            />
          </Field>
          {sign.mode === "account" && (
            <Field label="Keystore account" hint="cast wallet import <name>">
              <TextField value={sign.account} onChange={(e) => setSign((p) => ({ ...p, account: e.target.value }))} />
            </Field>
          )}
          {needsSender ? (
            <Field label={<>Deployer address<span className="text-candy"> *</span></>} hint="must match the signing device">
              <TextField
                value={sign.sender}
                onChange={(e) => setSign((p) => ({ ...p, sender: e.target.value }))}
                placeholder="0x…"
                invalid={!!sign.sender.trim() && !isAddress(sign.sender)}
              />
            </Field>
          ) : (
            <div className="self-end text-[11px] text-ink/55">
              Export <code>DEPLOYER_PK</code> in your shell — never paste a private key into this console.
            </div>
          )}
        </div>
        <p className="mt-2 text-[11px] text-ink/45">
          The deployer owns all 10 contracts at first. Hand them to the owner hardware wallet immediately after
          (Ownable2Step: transfer → accept, in Access &amp; Safety).
        </p>
      </AdminCard>

      <AdminCard
        title="Deploy command"
        action={blocked ? undefined : <CopyButton text={command} label="Copy" />}
      >
        {blocked && (
          <Banner tone="error" icon={<Warning weight="bold" size={14} />}>
            Malformed: {badFields.join(", ")}. <strong>Command withheld</strong> — a malformed price
            would export as <code>0</code> wei, and forge accepts that silently.
          </Banner>
        )}
        {!blocked && missing.length > 0 && (
          <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
            Fill required fields: {missing.join(", ")}
          </Banner>
        )}
        {!blocked && zeroPrices.length > 0 && (
          <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
            Zero price on {zeroPrices.join(", ")} — that ships free forever. Only the daily single is
            meant to be 0.
          </Banner>
        )}
        {blocked ? (
          <div className="mt-2 rounded-xl border-2 border-dashed border-candy/50 bg-candy/[0.06] p-4 text-center text-xs font-bold text-ink/50">
            Fix the fields above to generate the command.
          </div>
        ) : (
          <pre className="mt-2 overflow-x-auto rounded-xl border-2 border-ink bg-ink/[0.04] p-3 font-mono text-[11px] leading-relaxed text-ink/85">
            {command}
          </pre>
        )}
      </AdminCard>

      <AdminCard title="Deploy order">
        <SectionLabel>10 contracts, in dependency order — constructor inputs</SectionLabel>
        <ol className="space-y-2">
          {[...CONTRACTS].sort((a, b) => a.order - b.order).map((c) => (
            <li key={c.key} className="border-t-2 border-ink/10 pt-2 first:border-0 first:pt-0">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-xs text-ink/40">{c.order}</span>
                <span className="font-display text-sm font-extrabold">{c.name}</span>
              </div>
              <p className="text-xs text-ink/55">{c.purpose}</p>
              <p className="mt-0.5 font-mono text-[10px] text-ink/45">{c.ctor.map((a) => `${a.type} ${a.name}`).join(", ")}</p>
            </li>
          ))}
        </ol>
      </AdminCard>

      <AdminCard
        title="Capture the deployed addresses"
        action={
          parsedCount > 0 ? (
            <button
              onClick={saveToRegistry}
              className="inline-flex items-center gap-1.5 rounded-lg border-2 border-ink bg-teal px-3 py-1.5 text-xs font-bold text-paper active:translate-y-[1px]"
            >
              {imported > 0 ? <Check weight="bold" size={13} /> : <Database weight="bold" size={13} />}
              {imported > 0 ? `Saved ${imported}` : `Save ${parsedCount} to registry`}
            </button>
          ) : undefined
        }
      >
        <SectionLabel>paste the forge output — the 10 printed lines are matched by name</SectionLabel>
        <textarea
          value={log}
          onChange={(e) => {
            setLog(e.target.value);
            setImported(0);
          }}
          rows={5}
          spellCheck={false}
          placeholder={"FeeRouter         0x…\nLetters           0x…\n…"}
          className="mt-2 w-full rounded-xl border-[3px] border-ink bg-paper px-3 py-2 font-mono text-[11px] outline-none focus:bg-paper-dark/40"
        />
        <div className="mt-3 grid gap-1 sm:grid-cols-2">
          {CONTRACT_KEYS.map((k) => {
            const c = CONTRACTS.find((x) => x.key === k)!;
            const addr = parsed[k];
            return (
              <div key={k} className="flex items-baseline justify-between gap-2 border-t-2 border-ink/10 py-1 text-xs">
                <span className="font-bold text-ink/70">{c.name}</span>
                <span className={`font-mono text-[11px] ${addr ? "text-teal" : "text-ink/30"}`}>
                  {addr ? shortAddr(addr) : "—"}
                </span>
              </div>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-ink/45">
          Saving writes the addresses (plus treasury / signer / keeper from above) into the browser registry, the same
          store the Deployments tab exports — commit that JSON to make it permanent.
        </p>
      </AdminCard>

      <AdminCard title="After launch">
        <ul className="space-y-1.5 text-sm text-ink/75">
          {[
            "Capture the 10 printed addresses above, then export the JSON from Deployments and commit config/deployments.json.",
            "Verify the wiring checklist (Access & Safety tab) — collectors, payers, upgraders, AnswerChain keeper = Jackpot.",
            "Confirm the Words base URI resolves (tokenURI = base + decimal tokenId) and the metadata server is live.",
            "Transfer ownership of all 10 contracts to the owner key (a hardware wallet), then accept (Access & Safety).",
            "Confirm the keeper + signer are the production keys; leave the price keeper unset until repeg is needed.",
            "Seed the Rewards Pool if bootstrapping early yield (Treasury & Pools).",
            "Open the free-pack campaign (Letters · setFreePackOpen) at launch, and close it when the window ends.",
          ].map((s, i) => (
            <li key={i} className="flex items-start gap-2">
              <ListChecks weight="bold" size={15} className="mt-0.5 shrink-0 text-teal" /> {s}
            </li>
          ))}
        </ul>
      </AdminCard>
    </div>
  );
}
