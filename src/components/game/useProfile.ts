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
import { forgetVerifiedWallets } from "./useVerifiedWallet";

const HEADER = "x-lexigotchi-session";

// ── a link code waiting for its second wallet ─────────────────────────────────────────────────
/**
 * "Link another wallet" makes a code under the account's session; the wallet joining signs it. The
 * code waits here across a wallet switch in the same browser, or arrives from a `?link=` URL opened
 * on another device or in a Farcaster host. One at a time; it expires with the server's code.
 */
export interface PendingLink {
  code: string;
  /** Known when this browser made the code; unknown when it came in a link, until /message names it. */
  account?: string;
  /** The wallet that made the code here (it waits for another wallet; it is never offered the link). */
  madeBy?: string;
  expiresAt?: string;
}
const PENDING_KEY = "lexigotchi:link-code";
export function readPendingLink(): PendingLink | null {
  try {
    const v = JSON.parse(localStorage.getItem(PENDING_KEY) ?? "null") as PendingLink | null;
    if (!v || !/^[0-9a-f]{24}$/.test(v.code)) return null;
    if (v.expiresAt && Date.parse(v.expiresAt) < Date.now()) {
      localStorage.removeItem(PENDING_KEY);
      return null;
    }
    return v;
  } catch {
    return null;
  }
}
export function writePendingLink(v: PendingLink | null) {
  try {
    if (v) localStorage.setItem(PENDING_KEY, JSON.stringify(v));
    else localStorage.removeItem(PENDING_KEY);
    window.dispatchEvent(new Event(PENDING_KEY));
  } catch {
    /* storage blocked: the code lasts this page only */
  }
}
export const PENDING_LINK_EVENT = PENDING_KEY;

/**
 * The public view is cached (the route's s-maxage and stale-while-revalidate, at the edge and in the
 * browser), so after a change the next read must skip the caches, or a freshly linked wallet keeps
 * showing the old account for minutes. A change bumps this; the URL carries it.
 */
let publicBust = 0;
export function bustPublicProfile() {
  publicBust = Date.now();
}
const publicProfileUrl = (addr: string | null) => `/api/profile/public?address=${addr}${publicBust ? `&t=${publicBust}` : ""}`;
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
      const r = await fetch(publicProfileUrl(addr));
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
        // A /me fetch still in flight (the sheet shows the picker as soon as a session is stored)
        // would land after this and put the old choice back: cancel it first (Bugbot on #136).
        await qc.cancelQueries({ queryKey: ["profileMe", addr, token] });
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
        const d = (await r.json()) as { ok: boolean; url?: string; error?: string };
        if (!d.ok || !d.url)
          throw new Error(
            d.error === "x_used_today" ? "Your X account took today’s letter. You can change it tomorrow." : "Couldn’t reach X. Try again.",
          );
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
      if (!d.ok || !d.profile)
        throw new Error(
          (d as { error?: string }).error === "x_used_today"
            ? "You took today’s letter with this X account. You can unlink it tomorrow."
            : "Couldn’t unlink X. Try again.",
        );
      await qc.cancelQueries({ queryKey: ["profileMe", addr, t] });
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

  /** A live session token, signing in first if there isn't one. */
  const ensureToken = useCallback(async (): Promise<string | null> => {
    if (!addr) return null;
    if (token) return token;
    if (!(await signIn())) return null;
    return (qc.getQueryData(["profileToken", addr]) as string | null) ?? null;
  }, [addr, qc, signIn, token]);

  /**
   * One authenticated email call. Returns the server's error code (null on success), and keeps
   * the profile cache in step with whatever profile the server sends back.
   */
  const emailCall = useCallback(
    async (path: string, method: "POST" | "DELETE" | "PATCH", body?: unknown): Promise<{ error: string | null; triesLeft?: number }> => {
      const t = await ensureToken();
      if (!t || !addr) return { error: "no_session" };
      setBusy(true);
      setError(null);
      try {
        const r = await fetch(path, {
          method,
          headers: { "content-type": "application/json", [HEADER]: t },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        if (r.status === 401) forget();
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; profile?: ProfileView; error?: string; triesLeft?: number };
        if (d.profile) {
          await qc.cancelQueries({ queryKey: ["profileMe", addr, t] });
          qc.setQueryData(["profileMe", addr, t], d.profile);
        }
        return { error: d.ok ? null : (d.error ?? "failed"), triesLeft: d.triesLeft };
      } catch {
        return { error: "failed" };
      } finally {
        setBusy(false);
      }
    },
    [addr, ensureToken, forget, qc],
  );

  /**
   * After a wallet joins or leaves: every view that reads the account (public profile, bag, world,
   * the daily's status, the Coinbase check) refetches, skipping caches that would show the old one.
   */
  const afterAccountChange = useCallback(() => {
    bustPublicProfile();
    forgetVerifiedWallets();
    void qc.invalidateQueries({ queryKey: ["profilePublic"] });
    void qc.invalidateQueries({ queryKey: ["world"] });
    void qc.invalidateQueries({ queryKey: ["dailyStatus"] });
  }, [qc]);

  /** A single-use code for another wallet to join this account (the account's session). */
  const makeLinkCode = useCallback(async (): Promise<{ code: string; account: string; expiresAt: string } | { error: string }> => {
    const t = await ensureToken();
    if (!t || !addr) return { error: "no_session" };
    setBusy(true);
    try {
      const r = await fetch("/api/profile/wallets/code", { method: "POST", headers: { [HEADER]: t } });
      if (r.status === 401) forget();
      const d = (await r.json().catch(() => ({}))) as { ok?: boolean; code?: string; account?: string; expiresAt?: string; error?: string };
      return d.ok && d.code && d.account && d.expiresAt ? { code: d.code, account: d.account, expiresAt: d.expiresAt } : { error: d.error ?? "failed" };
    } catch {
      return { error: "failed" };
    } finally {
      setBusy(false);
    }
  }, [addr, ensureToken, forget]);

  /** Sign the link message for `code` with the CONNECTED wallet, joining the account the code names. */
  const joinWithCode = useCallback(async (code: string): Promise<{ account: string } | { error: string }> => {
    if (!address) return { error: "no_wallet" };
    setBusy(true);
    setError(null);
    try {
      const m = (await (await fetch("/api/profile/wallets/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code, address }),
      })).json()) as { ok?: boolean; message?: string; account?: string; error?: string };
      if (!m.ok || !m.message) return { error: m.error ?? "failed" };
      const signature = await signMessageAsync({ message: m.message });
      const l = (await (await fetch("/api/profile/wallets/link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: m.message, signature }),
      })).json()) as { ok?: boolean; account?: string; error?: string };
      if (!l.ok || !l.account) return { error: l.error ?? "failed" };
      // Every wallet's public view, the bag, and the world now see the account.
      afterAccountChange();
      void qc.invalidateQueries({ queryKey: ["profileMe"] });
      return { account: l.account };
    } catch (err) {
      const msg = String((err as Error)?.message ?? "");
      const c = (err as { code?: number })?.code;
      return { error: c === 4001 || /reject|denied/i.test(msg) ? "rejected" : "failed" };
    } finally {
      setBusy(false);
    }
  }, [address, qc, signMessageAsync, afterAccountChange]);

  /** Take a wallet out of the account (any wallet's session in the account). */
  const unlinkWallet = useCallback(async (wallet: string) => {
    const r = await emailCall("/api/profile/wallets", "DELETE", { address: wallet });
    if (!r.error) afterAccountChange();
    return r;
  }, [emailCall, afterAccountChange]);

  return {
    /** The server has profiles switched on (flag, secret, database). */
    enabled,
    xEnabled: Boolean(config.data?.x),
    emailEnabled: Boolean(config.data?.email),
    address: addr,
    // A stored session counts at once. Waiting for /me made the sheet ask a player to sign in
    // while their session was still loading (Bugbot on #136); a dead token is forgotten on its 401.
    signedIn: Boolean(token),
    /**
     * The own view (with email) has loaded. Until it does, `profile` is the public view, whose email
     * is always null, so "no email" can't be told apart from "not loaded yet" without this.
     */
    ownLoaded: Boolean(me.data),
    ownFailed: me.isError || (me.isFetched && !me.data && Boolean(token)),
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
    ensureToken,
    makeLinkCode,
    joinWithCode,
    unlinkWallet,
    sendEmailCode: (email: string) => emailCall("/api/profile/email", "POST", { email }),
    confirmEmail: (email: string, code: string) => emailCall("/api/profile/email/verify", "POST", { email, code }),
    removeEmail: () => emailCall("/api/profile/email", "DELETE"),
    setEmailReminders: (on: boolean) => emailCall("/api/profile/me", "PATCH", { emailReminders: on }),
  };
}

/**
 * The wallet's public profile and whether its linked X unlocks the daily, with no session needed.
 * Shares useProfile's cache entries, so it costs nothing extra where both are used.
 */
export function usePublicProfile(): {
  profile: PublicProfileView | null;
  xCounts: boolean;
  loading: boolean;
  xEnabled: boolean;
  emailEnabled: boolean;
  profilesEnabled: boolean;
} {
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
      const r = await fetch(publicProfileUrl(addr));
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
    emailEnabled: Boolean(config.data?.email),
    /** Profiles are on, so wallets can be linked into one account. */
    profilesEnabled: Boolean(config.data?.profiles),
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
