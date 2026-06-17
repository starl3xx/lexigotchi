"use client";
/**
 * useAddMiniApp — one home for the "add Lexigotchi to your Farcaster apps" action
 * (`sdk.actions.addMiniApp`), shared by the pre-launch splash and the post-mint nudge.
 *
 * `addMiniApp()` takes no args and resolves `{ notificationDetails? }`, but THROWS on failure:
 * `AddMiniApp.RejectedByUser` when the player declines, `AddMiniApp.InvalidDomainManifest` when the
 * domain's `accountAssociation` isn't published yet. `add()` maps those to a friendly message and
 * returns `{ ok, error? }` instead of throwing, so callers just branch on `ok`.
 */
import { useCallback, useState } from "react";
import { useMiniApp } from "@neynar/react";
import { useViewer } from "./useViewer";
import { recordAdd } from "./campaignClient";

export interface AddResult {
  ok: boolean;
  error?: string;
}

export function useAddMiniApp() {
  const mini = useMiniApp();
  const viewer = useViewer();
  const [adding, setAdding] = useState(false);

  const add = useCallback(async (): Promise<AddResult> => {
    setAdding(true);
    try {
      const sdk = (await import("@farcaster/miniapp-sdk")).default;
      const result = await sdk.actions.addMiniApp(); // no args; resolves { notificationDetails? }
      void recordAdd(result?.notificationDetails); // persist the add (+ notif token) server-side
      return { ok: true };
    } catch (err) {
      const name = (err as { name?: string })?.name;
      if (name === "AddMiniApp.RejectedByUser") return { ok: false, error: "No problem — you can add Lexigotchi any time." };
      if (name === "AddMiniApp.InvalidDomainManifest")
        return { ok: false, error: "Can't add just yet — the app isn't fully published. Try again shortly." };
      return { ok: false, error: "Couldn't add right now — give it another tap." };
    } finally {
      setAdding(false);
    }
  }, []);

  return {
    add,
    adding,
    /** Already saved to the player's Farcaster apps (the SDK's own flag). */
    added: !!mini.added,
    /** `addMiniApp` only works inside a Farcaster client. */
    inFarcaster: viewer.environment === "farcaster",
    /** SDK identity resolved (no longer "loading"). */
    ready: viewer.environment !== "loading",
  };
}
