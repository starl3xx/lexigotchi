/**
 * The account behind a profile session: the session proves one wallet, and the profile (X, email,
 * name and picture) belongs to that wallet's account (lib/db/walletLinks.ts). A wallet that isn't
 * linked is its own account, so before migration 0008 this is just the session's wallet.
 */
import { accountOf } from "@/lib/db/walletLinks";
import { sessionAddress } from "./session";

export async function sessionAccountOf(req: Request): Promise<string | null> {
  const wallet = sessionAddress(req);
  return wallet ? accountOf(wallet) : null;
}
