"use client";
/**
 * Ask the wallet to show its account picker, so a player can hop to the linked wallet that holds
 * the piece they want to act on. The app cannot CHOOSE the account — EIP-1193 gives dapps no say —
 * but `wallet_requestPermissions` makes MetaMask/Rabby open the selector, and wagmi's injected
 * connector follows the resulting `accountsChanged`, which re-attributes `mine` across the union
 * bag automatically. Wallets without the permissions RPC fall back to `eth_requestAccounts`,
 * which at minimum re-surfaces the connect UI.
 *
 * Best-effort by design: every failure path is a user closing a picker, which needs no toast.
 */
export async function promptAccountSwitch(): Promise<void> {
  const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
  if (!eth) return;
  try {
    await eth.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
  } catch {
    try {
      await eth.request({ method: "eth_requestAccounts" });
    } catch {
      /* picker dismissed — nothing to do */
    }
  }
}
