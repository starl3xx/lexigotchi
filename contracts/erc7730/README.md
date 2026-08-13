# ERC-7730 clear-signing metadata (drafts)

Plain-English wallet prompts for every player-facing transaction — "Purchase a 5-pack of
letters" instead of `commitPack()`. Jake's call (2026-08-13): we want this at mainnet.

These are DRAFTS against the current ABIs. They cannot be submitted yet because the registry
keys on deployed addresses and the suite only exists on Sepolia (chainId 8453 addresses are
`0xMAINNET_*_TBD` placeholders).

## At mainnet

1. Fill every `deployments[].address` from the mainnet registry (config/deployments.json).
2. Validate: `pipx run erc7730 lint contracts/erc7730/` (Ledger's linter; schema drift is
   likely between now and then — fix what it flags).
3. PR the files into github.com/LedgerHQ/clear-signing-erc7730-registry under
   `registry/lexigotchi/`.

Coverage: Letters (packs, dailies, reveal), Words (claim, dissolve), Rolls, Staking
(stake/unstake/feed), Prestige, and the two MerkleEpochs claim surfaces. Operator-only
functions are deliberately absent — clear signing is for players.
