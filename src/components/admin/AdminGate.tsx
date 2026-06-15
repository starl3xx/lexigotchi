"use client";
/**
 * Client-side access gate for the operator console.
 *
 * Resolves the connected Farcaster identity (mini-app or Sign In With Neynar) and checks it against
 * the allowlist in `lib/admin/auth`. When no allowlist is configured the console is dev-open. The
 * real security boundary for any on-chain action is the owner's wallet signature, not this gate —
 * see the note in `auth.ts`. A hidden NeynarAuthButton powers web sign-in (clicked by viewer.signIn).
 */
import { NeynarAuthButton } from "@neynar/react";
import { useViewer } from "@/components/game/useViewer";
import { ADMIN_OPEN, ADMIN_UNCONFIGURED, isAdminFid } from "@/lib/admin/auth";
import { AdminConsole } from "./AdminConsole";
import { CircleNotch, ShieldCheck } from "./icons";

export function AdminGate() {
  const v = useViewer();
  const allowed = ADMIN_OPEN || (v.isAuthed && isAdminFid(v.fid));

  return (
    <>
      {/* Hidden Sign In With Neynar trigger for web operators; viewer.signIn() clicks it. */}
      <div data-lexi-siwn className="sr-only">
        <NeynarAuthButton />
      </div>

      {v.environment === "loading" ? (
        <div className="flex min-h-screen items-center justify-center bg-paper">
          <CircleNotch weight="bold" size={28} className="animate-spin text-ink/40" />
        </div>
      ) : allowed ? (
        <AdminConsole
          operator={{
            kind: ADMIN_OPEN ? "dev" : "fid",
            label: v.username ? `@${v.username}` : v.fid ? `fid ${v.fid}` : "operator",
          }}
        />
      ) : (
        <GateScreen viewer={v} />
      )}
    </>
  );
}

function GateScreen({ viewer }: { viewer: ReturnType<typeof useViewer> }) {
  if (ADMIN_UNCONFIGURED) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="cel w-full max-w-md rounded-2xl bg-paper p-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-ink bg-paper-dark">
            <ShieldCheck weight="bold" size={24} />
          </div>
          <h1 className="font-display text-2xl font-extrabold">Console not configured</h1>
          <p className="mt-2 text-sm text-ink/65">
            The operator console is locked on this deployment (fail-closed). Set{" "}
            <code className="text-xs">NEXT_PUBLIC_ADMIN_FIDS</code> to your Farcaster FID and redeploy — or set{" "}
            <code className="text-xs">NEXT_PUBLIC_ADMIN_OPEN=1</code> to open it deliberately.
          </p>
          <p className="mt-4 text-xs text-ink/40">
            <a href="/play" className="underline">← Back to the game</a>
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="cel w-full max-w-md rounded-2xl bg-paper p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full border-[3px] border-ink bg-paper-dark">
          <ShieldCheck weight="bold" size={24} />
        </div>
        <h1 className="font-display text-2xl font-extrabold">Operator access</h1>
        {viewer.isAuthed ? (
          <p className="mt-2 text-sm text-ink/65">
            Signed in as <strong>{viewer.username ? `@${viewer.username}` : `fid ${viewer.fid}`}</strong>, but this
            identity isn&apos;t on the operator allowlist. Ask the owner to add your FID to{" "}
            <code className="text-xs">NEXT_PUBLIC_ADMIN_FIDS</code>.
          </p>
        ) : (
          <p className="mt-2 text-sm text-ink/65">
            This console is for the game&apos;s owner / operator. Sign in with your Farcaster account to continue.
          </p>
        )}
        {!viewer.isAuthed && (
          <button
            onClick={viewer.signIn}
            className="mt-4 rounded-xl border-[3px] border-ink bg-candy px-5 py-2.5 font-display font-extrabold text-paper shadow-[3px_3px_0_#1b1714] active:translate-x-[3px] active:translate-y-[3px] active:shadow-none"
          >
            Sign in with Neynar
          </button>
        )}
        <p className="mt-4 text-xs text-ink/40">
          <a href="/play" className="underline">
            ← Back to the game
          </a>
        </p>
      </div>
    </div>
  );
}
