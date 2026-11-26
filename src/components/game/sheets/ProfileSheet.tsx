"use client";
/**
 * Your profile, opened from the PFP in the header. The accounts linked to this wallet (Farcaster,
 * Coinbase verification, and X once it's switched on), the free letters they unlock, and the
 * name and picture a linked account gives you. "Your $WORD" (balance, buy, wallet) stays on the
 * balance pill.
 *
 * A name and picture come only from a linked account, never typed in (Jake, 2026-11-23: "only if
 * it's tied to X or FC"). With both linked, the player picks which one. Saving that choice needs a
 * wallet session (useProfile): one free signature that proves the wallet is theirs.
 */
import { useState } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Button, Card, Sheet } from "../primitives";
import { Check, CheckCircle, CircleNotch, Gift, Lock, SealCheck, Smiley, Wallet, XLogo } from "../ui/icons";
import { useGame } from "../state";
import { useViewer } from "../useViewer";
import { useVerifiedWallet } from "../useVerifiedWallet";
import { useDailyEligibility } from "../DailyUnlock";
import { resolveIdentity, useProfile } from "../useProfile";
import { ReminderToggle } from "../ReminderToggle";
import { ReminderChoices } from "../ReminderChoices";
import { WalletsCard } from "./WalletsCard";
import { OnchainBadges } from "../OnchainBadges";
import { useOpenUrl } from "../useShare";
import { VERIFY_URL } from "@/lib/onchain/verifications";
import { xEligibleOn, xOldEnough, type NameSource } from "@/lib/profile/rules";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

export function ProfileSheet() {
  const g = useGame();
  const viewer = useViewer();
  const { address } = useAccount();
  const { verified, recheck } = useVerifiedWallet();
  const daily = useDailyEligibility();
  // With no wallet and no Farcaster, there is nothing to check: the hook's "checking" would spin forever.
  const checking = daily.checking && (Boolean(address) || viewer.environment === "loading");
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const p = useProfile();
  const openUrl = useOpenUrl();
  const me = resolveIdentity(viewer, p.profile);
  const x = p.profile?.x ?? null;
  const linkX = async () => {
    // Inside a Farcaster host, X opens in another browser that can't return into the frame: the
    // callback shows a "go back to the game" page, and the profile refetches when the game regains focus.
    const inHost = viewer.environment === "farcaster";
    const url = await p.startXLink(inHost ? "page" : "redirect");
    if (!url) return;
    if (inHost) void openUrl(url);
    else window.location.assign(url);
  };

  // Signed in IS linked, even before the username arrives (web sign-in proves the FID first, and
  // /api/auth/profile fills the name in later, or fails): Bugbot on #136.
  const fcLinked = viewer.isAuthed;
  const fcLabel = viewer.username ? `@${viewer.username}` : viewer.fid ? `FID ${viewer.fid}` : "Farcaster";
  const xLinked = !!p.profile?.x;
  const sources: { id: NameSource; label: string; pfpUrl: string | null }[] = [
    // A name source needs a name: Farcaster counts once its username is known.
    ...(fcLinked && viewer.username ? [{ id: "farcaster" as const, label: `@${viewer.username}`, pfpUrl: viewer.pfpUrl }] : []),
    ...(xLinked ? [{ id: "x" as const, label: `@${p.profile!.x!.username}`, pfpUrl: p.profile!.x!.pfpUrl }] : []),
  ];
  const unlockWith = p.xEnabled ? "X or Farcaster" : "Farcaster";
  const dailyWith = p.xEnabled ? "X, Farcaster, or Coinbase" : "Farcaster or Coinbase";

  return (
    <Sheet open onClose={g.closeSheet} title="Your profile">
      {/* who you are */}
      <div className="mb-3 flex items-center gap-3">
        {me.pfpUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={me.pfpUrl} alt="" className="h-14 w-14 rounded-full border-[3px] border-ink object-cover" />
        ) : (
          <span className="flex h-14 w-14 items-center justify-center rounded-full border-[3px] border-ink bg-paper-dark text-ink/50">
            <Smiley weight="fill" size={26} />
          </span>
        )}
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate font-display text-xl font-extrabold">{me.name ?? (address ? short(address) : "No wallet yet")}</div>
          <div className="text-xs text-ink/55">
            {address ? (me.name ? short(address) : `Link ${unlockWith} for a name and picture`) : "Your wallet is your account"}
          </div>
        </div>
        {!address && viewer.environment === "web" && openConnectModal && (
          <Button size="sm" variant="teal" onClick={openConnectModal}>
            <Wallet weight="bold" /> Connect
          </Button>
        )}
        {/* Out of this wallet, on the web (in a Farcaster host the wallet is the host's). wagmi's own
            disconnect, not RainbowKit's account modal, which isn't offered on a network it doesn't know. */}
        {address && viewer.environment === "web" && (
          <Button size="sm" variant="ghost" onClick={() => disconnect()}>
            Disconnect
          </Button>
        )}
      </div>

      {/* your onchain badges, once you've earned one (they lived on the Showcase) */}
      <OnchainBadges />

      {/* the free letters (decisions.md #21): a pack of 5 plus 10 daily letters per verified profile */}
      <Card className={`mb-3 ${daily.eligible ? "bg-teal/10" : "bg-gold/10"}`}>
        <div className="flex items-center gap-1.5 font-display font-extrabold">
          <Gift weight="fill" className={daily.eligible ? "text-teal-ink" : "text-gold-ink"} /> Free letters
        </div>
        <p className="mt-1 text-sm text-ink/75">
          {daily.eligible ? (
            <>You get a free pack of 5 plus 10 free daily letters, one a day.</>
          ) : checking ? (
            <>Checking your accounts…</>
          ) : (
            <>Link {dailyWith} to get a free pack of 5 plus 10 free daily letters.</>
          )}
          {daily.eligible && g.freeLetters && (
            <>
              {" "}
              {g.freeLetters.done
                ? `You’ve had all ${g.freeLetters.dailyLimit} daily letters`
                : g.freeLetters.dailyLeft != null
                  ? `${g.freeLetters.dailyLeft} daily letter${g.freeLetters.dailyLeft === 1 ? "" : "s"} left`
                  : ""}
              {g.freeLetters.dailyLeft != null || g.freeLetters.done ? (g.freeLetters.packTaken ? ", and your pack is opened." : ", and your pack is waiting in Mint.") : ""}
            </>
          )}
        </p>
      </Card>

      {/* linked accounts */}
      <Card className="mb-3">
        <div className="mb-2 font-display font-extrabold">Linked accounts</div>
        <div className="divide-y-2 divide-ink/10">
          {/* Farcaster */}
          <Row
            icon={
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/fc-arch-icon.png" alt="" className="h-3 w-auto" />
            }
            iconBg="bg-[#855DCD]"
            name="Farcaster"
            detail={fcLinked ? (viewer.username && viewer.fid ? `${fcLabel} · FID ${viewer.fid}` : fcLabel) : "Free letters, name, and picture"}
          >
            {fcLinked ? (
              // Sign-out exists only on the web: inside a Farcaster host the identity IS the host's.
              viewer.environment === "web" ? (
                <button onClick={viewer.signOut} className="text-xs font-bold text-ink/45 underline">
                  Sign out
                </button>
              ) : (
                <Linked />
              )
            ) : viewer.environment === "web" ? (
              <Button size="sm" variant="ghost" onClick={viewer.signIn}>
                Link
              </Button>
            ) : null}
          </Row>

          {/* X: shown once the server has it switched on. Linking makes the account public next to
              the wallet (Jake, 2026-11-23: "public, with a clear notice"), so the notice sits right
              under the button that does it. */}
          {/* Also shown while an X account is still linked with X switched off: the link stays
              public, so its Unlink must stay reachable (Bugbot on #137). Link needs X on. */}
          {(p.xEnabled || x) && (
            <div className="py-2">
              <Row
                icon={<XLogo weight="bold" size={13} className="text-paper" />}
                iconBg="bg-ink"
                name="X"
                detail={
                  x
                    ? xOldEnough(x.createdAt)
                      ? `@${x.username}`
                      : x.createdAt
                        ? `@${x.username} · free letters from ${xEligibleOn(x.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`
                        : `@${x.username}`
                    : "Free letters, name, and picture"
                }
                flush
              >
                {x ? (
                  <button onClick={() => void p.unlinkX()} disabled={p.busy} className="text-xs font-bold text-ink/45 underline">
                    Unlink
                  </button>
                ) : p.xEnabled && (address || openConnectModal) ? (
                  // An X link belongs to a wallet, so with none connected the same tap opens the wallet
                  // picker first. A hidden button read as broken ("why doesn't X show Link?").
                  <Button size="sm" variant="ghost" disabled={p.busy} onClick={() => (address ? void linkX() : openConnectModal?.())}>
                    {p.busy ? <CircleNotch className="animate-spin" /> : "Link"}
                  </Button>
                ) : null}
              </Row>
              {!x && p.xEnabled && (
                <p className="mt-1 pl-[38px] text-[11px] leading-snug text-ink/55">
                  {!address && "Connect a wallet first: X links to it. "}Your X account will show publicly next to your wallet. The account must be older than 90 days for the free letters. You can unlink anytime.
                </p>
              )}
            </div>
          )}

          {/* Coinbase verification: proves one person, so it unlocks the daily (no name or picture). */}
          <Row
            icon={<SealCheck weight="fill" size={14} className="text-paper" />}
            iconBg="bg-[#0052FF]"
            name="Coinbase verified"
            detail={
              verified === true
                ? (p.profile?.wallets?.length ?? 1) > 1
                  ? "A wallet in your account is verified" // the check covers every linked wallet
                  : "This wallet is verified"
                : address && verified === null
                  ? "Checking this wallet…"
                  : address
                    ? "Verify this wallet for the free letters"
                    : "Connect a verified wallet"
            }
          >
            {verified === true ? (
              <Linked />
            ) : address ? (
              <div className="flex flex-col items-end gap-1">
                <a
                  href={VERIFY_URL}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setTimeout(recheck, 4000)}
                  className="cel-sm press rounded-lg bg-card px-2.5 py-1 text-xs font-extrabold"
                >
                  Verify ↗
                </a>
                {/* Verification usually outlasts the 4-second re-check, and a "no" gets cached. */}
                {verified === false && (
                  <button onClick={recheck} className="text-[11px] font-bold text-ink/45 underline">
                    Check again
                  </button>
                )}
              </div>
            ) : openConnectModal ? (
              <Button size="sm" variant="ghost" onClick={openConnectModal}>
                Connect
              </Button>
            ) : null}
          </Row>
        </div>
      </Card>

      {/* the account's wallets: Link another wallet */}
      <WalletsCard p={p} />

      {/* name and picture */}
      <Card className="mb-3">
        <div className="mb-1 font-display font-extrabold">Name and picture</div>
        {sources.length === 0 ? (
          <p className="flex items-center gap-1.5 text-sm text-ink/65">
            <Lock weight="fill" className="shrink-0 text-ink/45" /> Link {unlockWith} to unlock a name and picture.
          </p>
        ) : sources.length === 1 || !p.enabled ? (
          <p className="text-sm text-ink/70">
            From {me.source === "x" ? "X" : "Farcaster"}: <strong>{me.name}</strong>.
          </p>
        ) : !p.signedIn ? (
          <>
            <p className="text-sm text-ink/70">
              Showing <strong>{me.name}</strong>. To choose which account names you, sign in with your wallet.
            </p>
            <SignInButton p={p} />
          </>
        ) : (
          <div className="mt-1 space-y-1.5" role="radiogroup" aria-label="Name and picture from">
            {sources.map((s) => {
              const on = me.source === s.id;
              return (
                <button
                  key={s.id}
                  role="radio"
                  aria-checked={on}
                  disabled={p.busy}
                  onClick={() => void p.setNameSource(s.id)}
                  className={`press flex w-full items-center gap-2.5 rounded-xl border-2 px-2.5 py-2 text-left text-sm ${on ? "border-ink bg-gold/15" : "border-ink/20 bg-card"}`}
                >
                  {s.pfpUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={s.pfpUrl} alt="" className="h-7 w-7 rounded-full border-2 border-ink object-cover" />
                  ) : (
                    <Smiley weight="fill" size={22} className="text-ink/45" />
                  )}
                  <span className="flex-1 font-bold">{s.label}</span>
                  <span className="text-xs text-ink/55">{s.id === "x" ? "X" : "Farcaster"}</span>
                  {on && <Check weight="bold" className="text-teal-ink" />}
                </button>
              );
            })}
          </div>
        )}
        {p.error && <p className="mt-2 text-xs font-bold text-candy-ink">{p.error}</p>}
      </Card>

      {/* Keyed by wallet: switching wallets starts the card fresh, so one wallet's typed address,
          code, or error never carries into another's session (Bugbot on #139). */}
      {p.emailEnabled && <EmailCard key={p.address ?? "none"} p={p} />}

      {/* Browser reminders, here as well as in More: the desktop rail has no More, so the profile is
          where a desktop player finds them. Renders nothing until web push is switched on. */}
      <div className="mb-3 empty:hidden">
        <ReminderToggle />
      </div>

      {/* Which reminders, for every channel (ReminderChoices). With profiles on (the route is theirs)
          and a wallet: a choice is the account's. */}
      {p.enabled && p.address && <ReminderChoices key={p.address} p={p} />}

      <button
        onClick={() => g.openSheet({ kind: "balance" })}
        className="mx-auto flex items-center gap-1.5 text-sm font-bold text-ink/60 underline"
      >
        <Wallet weight="bold" /> Your $WORD and wallet
      </button>
    </Sheet>
  );
}

function Row({
  icon,
  iconBg,
  name,
  detail,
  children,
  flush = false,
}: {
  icon: React.ReactNode;
  iconBg: string;
  name: string;
  detail: string;
  children?: React.ReactNode;
  /** No vertical padding, for a row inside a wrapper that pads. */
  flush?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2.5 ${flush ? "" : "py-2"}`}>
      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 border-ink ${iconBg}`}>{icon}</span>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="text-sm font-bold">{name}</div>
        <div className="truncate text-xs text-ink/55">{detail}</div>
      </div>
      {children}
    </div>
  );
}

function Linked() {
  return (
    <span className="flex items-center gap-1 text-xs font-bold text-teal-ink">
      <CheckCircle weight="fill" /> Linked
    </span>
  );
}

const EMAIL_ERRORS: Record<string, string> = {
  bad_email: "That doesn’t look like an email address.",
  too_many_codes: "Too many codes this hour. Try again later.",
  send_failed: "Couldn’t send the code. Try again.",
  code_expired: "That code expired. Send a new one.",
  email_taken: "Another wallet already uses that email.",
  bad_code: "Enter the 6-digit code from the email.",
  no_session: "Sign in with your wallet to change your email.",
};

/**
 * Email reminders: add an address, confirm it with a 6-digit code, then turn reminders on or off.
 * The address is never shown to anyone but this wallet's own session.
 */
function EmailCard({ p }: { p: ReturnType<typeof useProfile> }) {
  const { openConnectModal } = useConnectModal();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"start" | "enter" | "code">("start");
  const [note, setNote] = useState<string | null>(null);
  const saved = p.profile?.email ?? null;
  const say = (r: { error: string | null; triesLeft?: number }) =>
    setNote(r.error === "wrong_code" ? `That code didn’t match. ${r.triesLeft ?? 0} ${r.triesLeft === 1 ? "try" : "tries"} left.` : r.error ? (EMAIL_ERRORS[r.error] ?? "Something went wrong. Try again.") : null);

  return (
    <Card className="mb-3">
      <div className="font-display font-extrabold">Email reminders</div>
      <p className="mt-0.5 text-xs text-ink/60">
        Before a word goes hungry, when your daily letter is ready, and if you win the jackpot: the ones you keep on under “What to tell me”. Your email is never shown to anyone.
      </p>

      {p.signedIn && !p.ownLoaded ? (
        // Signed in, but the own view (the only one with the email) hasn't arrived: never offer
        // "Add email" to a player who may already have one (Bugbot on #139).
        <p className="mt-2 text-xs text-ink/55">{p.ownFailed ? "Couldn’t load your email settings. Close and reopen your profile to try again." : "Loading your email settings…"}</p>
      ) : saved ? (
        <div className="mt-2 space-y-2">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-bold">{saved.address}</span>
            <button onClick={async () => say(await p.removeEmail())} disabled={p.busy} className="shrink-0 text-xs font-bold text-ink/45 underline">
              Remove
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={saved.reminders}
              disabled={p.busy}
              onChange={async (e) => say(await p.setEmailReminders(e.target.checked))}
              className="h-4 w-4 accent-[#2a9d8f]"
            />
            Email me reminders
          </label>
        </div>
      ) : stage === "start" ? (
        <Button
          size="sm"
          variant="ghost"
          className="mt-2"
          disabled={p.busy || (!p.address && !openConnectModal)}
          onClick={async () => {
            // The email belongs to a wallet: with none connected, the tap opens the wallet picker first.
            if (!p.address) return openConnectModal?.();
            if (await p.ensureToken()) setStage("enter");
          }}
        >
          {p.busy ? <CircleNotch className="animate-spin" /> : "Add email"}
        </Button>
      ) : stage === "enter" ? (
        <form
          className="mt-2 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await p.sendEmailCode(email);
            say(r);
            if (!r.error) setStage("code");
          }}
        >
          <label className="block text-xs font-bold text-ink/60" htmlFor="profile-email">
            Email address
          </label>
          <div className="flex gap-2">
            <input
              id="profile-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              aria-invalid={note ? true : undefined}
              className="min-w-0 flex-1 rounded-xl border-2 border-ink bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-candy"
            />
            <Button size="sm" variant="teal" type="submit" disabled={p.busy}>
              {p.busy ? <CircleNotch className="animate-spin" /> : "Send code"}
            </Button>
          </div>
        </form>
      ) : (
        <form
          className="mt-2 space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await p.confirmEmail(email, code);
            say(r);
            if (!r.error) {
              setStage("start");
              setCode("");
            }
          }}
        >
          <label className="block text-xs text-ink/70" htmlFor="profile-email-code">
            We sent a 6-digit code to <strong>{email}</strong>.
          </label>
          <div className="flex gap-2">
            <input
              id="profile-email-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              placeholder="123456"
              aria-invalid={note ? true : undefined}
              className="w-28 rounded-xl border-2 border-ink bg-card px-3 py-2 text-center font-mono text-sm tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-candy"
            />
            <Button size="sm" variant="teal" type="submit" disabled={p.busy || code.length !== 6}>
              {p.busy ? <CircleNotch className="animate-spin" /> : "Confirm"}
            </Button>
          </div>
          <button type="button" onClick={() => setStage("enter")} className="text-xs font-bold text-ink/45 underline">
            Use a different email
          </button>
        </form>
      )}
      {note && (
        <p role="status" className="mt-2 text-xs font-bold text-candy-ink">
          {note}
        </p>
      )}
    </Card>
  );
}

function SignInButton({ p }: { p: ReturnType<typeof useProfile> }) {
  return (
    <Button size="sm" variant="teal" className="mt-2" disabled={p.busy || !p.address} onClick={() => void p.signIn()}>
      {p.busy ? <CircleNotch className="animate-spin" /> : <Wallet weight="bold" />}
      {p.busy ? "Check your wallet…" : "Sign in with wallet"}
    </Button>
  );
}
