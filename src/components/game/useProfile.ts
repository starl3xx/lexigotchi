"use client";
/**
 * The player's profile (lib/profile/*): whether the server has it switched on, the wallet session
 * that unlocks edits, and the profile itself.
 *
 * The session token lives in localStorage per wallet, and in react-query's cache, so every screen
 * that reads it (the header chip, the Profile sheet) sees a sign-in the moment it happens. It is a
 * 30-day proof that this browser's player controls the wallet; it grants profile edits, nothing
 * that moves tokens. A 401 from the server (expired, or the secret rotated) forgets it.
 */
import { useCallback, useState } from "react";
import { useAccount, useSignMessage } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { xOldEnough, type NameSource, type ProfileConfig, type ProfileView, type PublicProfileView } from "@/lib/profile/rules";
import type { Viewer } from "./useViewer";

const HEADER = "x-lexigotchi-session";
const storageKey = (a: string) => `lexigotchi:profileSession:${a.toLowerCase()}`;

function readToken(address: string): string | null {
  try {
    const raw = localStorage.getItem(storageKey(address));
    if (!raw) return null;
    const { token, expiresAt } = JSON.parse(raw) as { token?: string; expiresAt?: number };
    return token && expiresAt && expiresAt * 1000 > Date.now() ? token : null;
  } catch {
    return null;
  }
}

function writeToken(address: string, value: { token: string; expiresAt: number } | null) {
  try {
    if (value) localStorage.setItem(storageKey(address), JSON.stringify(value));
    else localStorage.removeItem(storageKey(address));
  } catch {
    /* private mode: the session lasts this page only */
  }
}

const SIGN_IN_ERRORS: Record<string, string> = {
  bad_signature: "That signature didn’t match this wallet. Try again.",
  stale_or_forged: "That sign-in took too long. Try again.",
  wrong_domain: "That sign-in was for another site.",
  rate_limited: "Too many tries. Wait a minute and try again.",
};

export function useProfile() {
  const { address } = useAccount();
  const addr = address?.toLowerCase() ?? null;
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const config = useQuery({
    queryKey: ["profileConfig"],
    queryFn: async (): Promise<ProfileConfig | null> => {
      const r = await fetch("/api/profile/config");
      return r.ok ? ((await r.json()) as ProfileConfig) : null;
    },
    staleTime: 5 * 60_000,
  });
  const enabled = Boolean(config.data?.profiles);

  const tokenQ = useQuery({
    queryKey: ["profileToken", addr],
    queryFn: () => (addr ? readToken(addr) : null),
    enabled: !!addr,
    staleTime: Infinity,
  });
  const token = tokenQ.data ?? null;

  const forget = useCallback(() => {
    if (!addr) return;
    writeToken(addr, null);
    qc.setQueryData(["profileToken", addr], null);
  }, [addr, qc]);

  const me = useQuery({
    queryKey: ["profileMe", addr, token],
    enabled: enabled && !!addr && !!token,
    queryFn: async (): Promise<ProfileView | null> => {
      const r = await fetch("/api/profile/me", { headers: { [HEADER]: token! } });
      if (r.status === 401) {
        forget();
        return null;
      }
      const d = (await r.json()) as { ok: boolean; profile?: ProfileView };
      return d.ok && d.profile ? d.profile : null;
    },
  });

  // The public view needs no session: a returning player's name, picture, and linked X show at once,
  // and the sheet knows there is something to sign in FOR (Bugbot on #136: reading X only through
  // the session made the sign-in prompt unreachable).
  const pub = useQuery({
    queryKey: ["profilePublic", addr],
    enabled: enabled && !!addr,
    staleTime: 30_000,
    queryFn: async (): Promise<PublicProfileView | null> => {
      const r = await fetch(`/api/profile/public?address=${addr}`);
      if (!r.ok) return null;
      const d = (await r.json()) as { ok: boolean; profile?: PublicProfileView };
      return d.ok && d.profile ? d.profile : null;
    },
  });

  /** Sign the challenge with the connected wallet and open a 30-day session. */
  const signIn = useCallback(async (): Promise<boolean> => {
    if (!address || !addr) return false;
    setBusy(true);
    setError(null);
    try {
      const c = (await (await fetch("/api/profile/challenge", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address }),
      })).json()) as { ok: boolean; message?: string; error?: string };
      if (!c.ok || !c.message) throw new Error(SIGN_IN_ERRORS[c.error ?? ""] ?? "Couldn’t start the sign-in. Try again.");
      const signature = await signMessageAsync({ message: c.message });
      const s = (await (await fetch("/api/profile/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: c.message, signature }),
      })).json()) as { ok: boolean; token?: string; expiresAt?: number; error?: string };
      if (!s.ok || !s.token || !s.expiresAt) throw new Error(SIGN_IN_ERRORS[s.error ?? ""] ?? "Couldn’t sign in. Try again.");
      writeToken(addr, { token: s.token, expiresAt: s.expiresAt });
      qc.setQueryData(["profileToken", addr], s.token);
      return true;
    } catch (err) {
      const msg = String((err as Error)?.message ?? "");
      const code = (err as { code?: number })?.code;
      setError(code === 4001 || /reject|denied/i.test(msg) ? null : msg.slice(0, 120) || "Couldn’t sign in.");
      return false;
    } finally {
      setBusy(false);
    }
  }, [address, addr, qc, signMessageAsync]);

  /** Choose which linked account names this wallet (null = automatic). */
  const setNameSource = useCallback(
    async (nameSource: NameSource | null): Promise<boolean> => {
      if (!token || !addr) return false;
      setBusy(true);
      setError(null);
      try {
        const r = await fetch("/api/profile/me", {
          method: "PATCH",
          headers: { "content-type": "application/json", [HEADER]: token },
          body: JSON.stringify({ nameSource }),
        });
        if (r.status === 401) forget();
        const d = (await r.json()) as { ok: boolean; profile?: ProfileView; error?: string };
        if (!d.ok || !d.profile) throw new Error(d.error === "farcaster_not_linked" ? "No Farcaster account has verified this wallet." : "Couldn’t save that. Try again.");
        qc.setQueryData(["profileMe", addr, token], d.profile);
        void qc.invalidateQueries({ queryKey: ["profilePublic", addr] });
        void qc.invalidateQueries({ queryKey: ["world"] });
        return true;
      } catch (err) {
        setError(String((err as Error)?.message ?? "Couldn’t save that."));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [addr, forget, qc, token],
  );

  /**
   * Start linking X: signs in first if needed, then asks the server for X's consent URL. Returns
   * the URL; the caller navigates (same tab on the web, the host's openUrl inside Farcaster).
   */
  const startXLink = useCallback(
    async (ret: "redirect" | "page"): Promise<string | null> => {
      if (!addr) return null;
      let t = token;
      if (!t) {
        if (!(await signIn())) return null;
        t = (qc.getQueryData(["profileToken", addr]) as string | null) ?? null;
        if (!t) return null;
      }
      setBusy(true);
      setError(null);
      try {
        const r = await fetch("/api/x/start", {
          method: "POST",
          headers: { "content-type": "application/json", [HEADER]: t },
          body: JSON.stringify({ return: ret }),
        });
        if (r.status === 401) forget();
        const d = (await r.json()) as { ok: boolean; url?: string };
        if (!d.ok || !d.url) throw new Error("Couldn’t reach X. Try again.");
        return d.url;
      } catch (err) {
        setError(String((err as Error)?.message ?? "Couldn’t reach X."));
        return null;
      } finally {
        setBusy(false);
      }
    },
    [addr, forget, qc, signIn, token],
  );

  const unlinkX = useCallback(async (): Promise<boolean> => {
    if (!addr) return false;
    // X can show from the public view without a session; unlinking still needs one.
    let t = token;
    if (!t) {
      if (!(await signIn())) return false;
      t = (qc.getQueryData(["profileToken", addr]) as string | null) ?? null;
      if (!t) return false;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/x/unlink", { method: "POST", headers: { [HEADER]: t } });
      if (r.status === 401) forget();
      const d = (await r.json()) as { ok: boolean; profile?: ProfileView };
      if (!d.ok || !d.profile) throw new Error("Couldn’t unlink X. Try again.");
      qc.setQueryData(["profileMe", addr, t], d.profile);
      void qc.invalidateQueries({ queryKey: ["profilePublic", addr] });
      void qc.invalidateQueries({ queryKey: ["world"] });
      return true;
    } catch (err) {
      setError(String((err as Error)?.message ?? "Couldn’t unlink X."));
      return false;
    } finally {
      setBusy(false);
    }
  }, [addr, forget, qc, signIn, token]);

  return {
    /** The server has profiles switched on (flag, secret, database). */
    enabled,
    xEnabled: Boolean(config.data?.x),
    emailEnabled: Boolean(config.data?.email),
    address: addr,
    signedIn: Boolean(token && me.data),
    /** The own view (with email) when signed in, else the public view. */
    profile: me.data ?? (pub.data ? { ...pub.data, email: null } : null),
    loading: me.isLoading || pub.isLoading,
    busy,
    error,
    signIn,
    signOut: forget,
    setNameSource,
    startXLink,
    unlinkX,
  };
}

/**
 * The wallet's public profile and whether its linked X unlocks the daily, with no session needed.
 * Shares useProfile's cache entries, so it costs nothing extra where both are used.
 */
export function usePublicProfile(): { profile: PublicProfileView | null; xCounts: boolean; loading: boolean; xEnabled: boolean } {
  const { address } = useAccount();
  const addr = address?.toLowerCase() ?? null;
  const config = useQuery({
    queryKey: ["profileConfig"],
    queryFn: async (): Promise<ProfileConfig | null> => {
      const r = await fetch("/api/profile/config");
      return r.ok ? ((await r.json()) as ProfileConfig) : null;
    },
    staleTime: 5 * 60_000,
  });
  const enabled = Boolean(config.data?.profiles);
  const pub = useQuery({
    queryKey: ["profilePublic", addr],
    enabled: enabled && !!addr,
    staleTime: 30_000,
    queryFn: async (): Promise<PublicProfileView | null> => {
      const r = await fetch(`/api/profile/public?address=${addr}`);
      if (!r.ok) return null;
      const d = (await r.json()) as { ok: boolean; profile?: PublicProfileView };
      return d.ok && d.profile ? d.profile : null;
    },
  });
  const xEnabled = Boolean(config.data?.x);
  const profile = pub.data ?? null;
  return {
    profile,
    xEnabled,
    // Mirrors the server (free-daily): X switched on, linked, and older than 90 days.
    xCounts: xEnabled && Boolean(profile?.x) && xOldEnough(profile?.x?.createdAt),
    loading: config.isLoading || (enabled && !!addr && pub.isLoading),
  };
}

export interface Identity {
  /** "@handle", or null when nothing is linked (the UI shows the short address). */
  name: string | null;
  pfpUrl: string | null;
  source: NameSource | null;
}

/**
 * The name and picture this player shows. Only a linked account gives one (Jake: "only if it's tied
 * to X or FC"). The player's choice wins when that account is still linked; otherwise Farcaster,
 * then X.
 */
export function resolveIdentity(viewer: Pick<Viewer, "isAuthed" | "username" | "pfpUrl">, profile: ProfileView | null): Identity {
  const fc = viewer.isAuthed && viewer.username ? { name: `@${viewer.username}`, pfpUrl: viewer.pfpUrl ?? null, source: "farcaster" as const } : null;
  const x = profile?.x ? { name: `@${profile.x.username}`, pfpUrl: profile.x.pfpUrl, source: "x" as const } : null;
  if (profile?.nameSource === "x" && x) return x;
  if (profile?.nameSource === "farcaster" && fc) return fc;
  return fc ?? x ?? { name: null, pfpUrl: null, source: null };
}
