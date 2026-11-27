"use client";
/**
 * Fetch for the GATED admin routes (`/api/admin/players`, `/api/admin/system`; lib/admin/serverAuth).
 *
 * The page's own gate (AdminGate) only decides what the console renders. These routes check a
 * credential on the server, so this hook sends one: the operator's wallet session (the same 30-day
 * sign-in the game's profile uses, read silently when this browser already has it), or a Quick Auth
 * token inside a Farcaster host. When the server asks for a sign-in, the tab shows a button that
 * opens the wallet's signature prompt; nothing prompts on its own.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useProfile } from "@/components/game/useProfile";
import { maybeAuthedFetch } from "@/components/game/campaignClient";

export interface AdminRefusal {
  error: "sign_in" | "not_allowed" | "not_configured" | string;
  hint: string;
  who?: string;
}

/** A gated route's refusal of a POST: its code, and whatever reasons the route gave with it. */
export interface AdminSendError {
  ok: false;
  error: string;
  errors?: string[];
  detail?: string;
  words?: string[];
}

const SESSION_HEADER = "x-lexigotchi-session";

export function useAdminApi<T>(path: string) {
  const profile = useProfile();
  const qc = useQueryClient();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<AdminRefusal | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const tick = useRef(0);
  const { address, signedIn, signIn: walletSignIn, signOut } = profile;

  const load = useCallback(
    async (fresh = false) => {
      const mine = ++tick.current;
      setLoading(true);
      setError(null);
      try {
        // The session token as useProfile stores it (its react-query cache), read at call time so a
        // sign-in a moment ago is used at once. No prompt here, ever.
        const token = address ? ((qc.getQueryData(["profileToken", address]) as string | null | undefined) ?? null) : null;
        const headers: Record<string, string> = token ? { [SESSION_HEADER]: token } : {};
        const url = fresh ? `${path}${path.includes("?") ? "&" : "?"}fresh=1` : path;
        const res = await maybeAuthedFetch(url, { cache: "no-store", headers });
        const body = (await res.json().catch(() => null)) as (T & { ok?: boolean }) | (AdminRefusal & { ok: false }) | null;
        if (mine !== tick.current) return;
        const r = body as AdminRefusal | null;
        if ((res.status === 401 || res.status === 403 || res.status === 503) && r?.error && r.hint) {
          setRefusal(r);
          setData(null);
          return;
        }
        if (!res.ok || !body) throw new Error(`Failed to load (${res.status})`);
        setRefusal(null);
        setData(body as T);
      } catch (e) {
        if (mine === tick.current) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (mine === tick.current) setLoading(false);
      }
    },
    // signedIn: a session arriving (or leaving) reloads with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [path, address, signedIn, qc],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Open the wallet's signature prompt for a fresh session, then load with it. A stored session the
   * server refused (it expired, or the secret rotated) is dropped first, or the button would resend
   * it forever.
   */
  const signIn = useCallback(async () => {
    setSigningIn(true);
    try {
      if (signedIn) signOut();
      if (await walletSignIn()) await load();
    } finally {
      setSigningIn(false);
    }
  }, [signedIn, signOut, walletSignIn, load]);

  /**
   * POST `body` to a gated route, with the same credential the load sends. Gives the route's JSON,
   * or `{ ok: false, error }` when it refused or couldn't be reached. Never prompts.
   */
  const send = useCallback(
    async <R,>(to: string, body: unknown): Promise<R | AdminSendError> => {
      try {
        const token = address ? ((qc.getQueryData(["profileToken", address]) as string | null | undefined) ?? null) : null;
        const res = await maybeAuthedFetch(to, {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json", ...(token ? { [SESSION_HEADER]: token } : {}) },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as (R & { ok?: boolean; error?: string }) | null;
        // The route's own body rides along: a refusal may list its reasons (`errors`, `detail`).
        if (!res.ok || !json || json.ok === false) return { ...(json as object | null), ok: false, error: json?.error ?? `Failed (${res.status})` };
        return json;
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : "Failed" };
      }
    },
    [address, qc],
  );

  /** GET a gated route's bytes (a report's screenshot), with the same credential: an <img> can't send a header. */
  const fetchBlob = useCallback(
    async (from: string): Promise<Blob | null> => {
      try {
        const token = address ? ((qc.getQueryData(["profileToken", address]) as string | null | undefined) ?? null) : null;
        const res = await maybeAuthedFetch(from, { cache: "no-store", headers: token ? { [SESSION_HEADER]: token } : {} });
        return res.ok ? await res.blob() : null;
      } catch {
        return null;
      }
    },
    [address, qc],
  );

  return {
    send,
    fetchBlob,
    data,
    loading,
    error,
    refusal,
    reload: (fresh = true) => void load(fresh),
    signIn,
    signingIn,
    /** A wallet is connected and the server has wallet sessions switched on. */
    canSignIn: Boolean(address) && profile.enabled,
    signInError: profile.error,
    address,
  };
}
