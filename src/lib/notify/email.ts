/**
 * Email: the 6-digit code that confirms an address, and reminders for players who turned them on
 * (Jake, 2026-11-23: "Reminders by email"). Sent through Resend's REST API (resend.com/docs, read
 * 2026-11-23), no SDK:
 *
 * - POST /emails for one message, POST /emails/batch for up to 100 (each with its own headers).
 * - `Authorization: Bearer <key>`, and a User-Agent, without which Resend answers 403.
 * - 10 requests a second per team by default; a 429 says rate_limit_exceeded or a quota.
 * - Every reminder carries List-Unsubscribe + List-Unsubscribe-Post (RFC 8058 one-click), which
 *   Gmail and Yahoo require of bulk senders. The link is an HMAC of the wallet, so it works
 *   without signing in and can't be forged for someone else's wallet.
 *
 * Dark until EMAIL_ENABLED=true, RESEND_API_KEY, and EMAIL_FROM (a verified Resend domain), and
 * profiles on. The address is never public and is never logged.
 */
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { profileSecret, profilesEnabled } from "@/lib/profile/session";

const RESEND = "https://api.resend.com";
const SITE = "https://lexigotchi.fun";
export const CODE_TTL_MS = 10 * 60_000;
export const CODE_MAX_ATTEMPTS = 5;
export const CODES_PER_HOUR = 5;

export function emailEnabled(): boolean {
  return profilesEnabled() && process.env.EMAIL_ENABLED === "true" && Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

/** A plausible address, lowercased; null otherwise. Deliberately simple: the code proves it works. */
export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length <= 254 && /^[^\s@<>()",;]+@[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(e) ? e : null;
}

export const newCode = (): string => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** The stored form of a code: an HMAC bound to the wallet and the address it was sent to. */
export function hashCode(secret: string, address: string, email: string, code: string): string {
  return createHmac("sha256", secret).update(`code|${address.toLowerCase()}|${email}|${code}`).digest("hex");
}

export function codeMatches(secret: string, stored: string, address: string, email: string, code: string): boolean {
  if (!/^\d{6}$/.test(code)) return false;
  const a = Buffer.from(stored), b = Buffer.from(hashCode(secret, address, email, code));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── unsubscribe links ────────────────────────────────────────────────────────────────────────────
export function unsubscribeToken(secret: string, address: string): string {
  return createHmac("sha256", secret).update(`unsub|${address.toLowerCase()}`).digest("hex").slice(0, 32);
}

export function unsubscribeUrl(address: string): string | null {
  const secret = profileSecret();
  if (!secret) return null;
  const a = address.toLowerCase();
  return `${SITE}/api/email/unsubscribe?a=${a}&t=${unsubscribeToken(secret, a)}`;
}

export function checkUnsubscribe(address: string, token: string): boolean {
  const secret = profileSecret();
  if (!secret || !/^[0-9a-f]{32}$/.test(token)) return false;
  const a = Buffer.from(token), b = Buffer.from(unsubscribeToken(secret, address));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── messages ─────────────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

function layout(title: string, bodyHtml: string, footerHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#f4ead2;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1b1714">
<div style="max-width:480px;margin:0 auto;background:#fbf4e3;border:3px solid #1b1714;border-radius:18px;padding:24px">
<div style="font-weight:800;font-size:13px;letter-spacing:.5px">LEXIGOTCHI</div>
<h1 style="font-size:22px;margin:10px 0 8px">${esc(title)}</h1>${bodyHtml}</div>
<p style="max-width:480px;margin:14px auto 0;font-size:12px;color:#1b1714a6;text-align:center">${footerHtml}</p></body></html>`;
}

export interface EmailMessage {
  /** The wallet it's for (never sent to Resend): lets a caller mark who was reached. */
  address?: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export function codeEmail(to: string, code: string): EmailMessage {
  const body = `<p style="margin:0 0 14px;color:#1b1714cc">Enter this code in Lexigotchi to confirm your email. It works for 10 minutes.</p>
<div style="font:800 32px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:6px;background:#f4ead2;border-radius:10px;padding:12px 18px;display:inline-block">${code}</div>`;
  return {
    to,
    subject: `Your Lexigotchi code: ${code}`,
    html: layout("Confirm your email", body, "If you didn’t ask for this, ignore it. Nothing changes."),
    text: `Your Lexigotchi code is ${code}. It works for 10 minutes.\n\nIf you didn’t ask for this, ignore it.`,
  };
}

/** A reminder, from the same { title, body } the Farcaster and browser channels send. */
export function reminderEmail(to: string, address: string, note: { title: string; body: string }): EmailMessage | null {
  const a = address.toLowerCase();
  const unsub = unsubscribeUrl(address);
  if (!unsub) return null; // never send a reminder without a working way out
  const play = `${SITE}/play`;
  const body = `<p style="margin:0 0 18px;color:#1b1714cc">${esc(note.body)}</p>
<a href="${play}" style="display:inline-block;background:#bd3d35;color:#fbf4e3;font-weight:800;text-decoration:none;border:3px solid #1b1714;border-radius:14px;padding:10px 18px">Open Lexigotchi</a>`;
  return {
    address: a,
    to,
    subject: note.title,
    html: layout(note.title, body, `You get these because you turned on email reminders in your Lexigotchi profile. <a href="${unsub}" style="color:#1b1714a6">Unsubscribe</a>.`),
    text: `${note.title}\n\n${note.body}\n\nOpen Lexigotchi: ${play}\n\nUnsubscribe: ${unsub}`,
    headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

// ── sending ──────────────────────────────────────────────────────────────────────────────────────
const headers = () => ({
  authorization: `Bearer ${process.env.RESEND_API_KEY}`,
  "content-type": "application/json",
  "user-agent": "lexigotchi/1.0",
});
const payload = (m: EmailMessage) => ({ from: process.env.EMAIL_FROM, to: m.to, subject: m.subject, html: m.html, text: m.text, ...(m.headers ? { headers: m.headers } : {}) });

/** One message (the confirmation code). Never throws. */
export async function sendEmail(m: EmailMessage): Promise<{ ok: boolean; status?: number }> {
  if (!emailEnabled()) return { ok: false };
  try {
    const r = await fetch(`${RESEND}/emails`, { method: "POST", headers: headers(), body: JSON.stringify(payload(m)), signal: AbortSignal.timeout(8_000) });
    if (!r.ok) console.error("[email] send failed:", r.status);
    return { ok: r.ok, status: r.status };
  } catch (err) {
    console.error("[email] send error:", String((err as Error)?.message ?? err).slice(0, 120));
    return { ok: false };
  }
}

/**
 * Many reminders, 100 per batch call, paced under the 10-a-second limit. Never throws.
 *
 * Send-once, twice over: `idempotency` names the run (kind + day), and each batch carries an
 * Idempotency-Key from it and the batch's recipients, so Resend drops a retried batch within 24 h;
 * `onSent` lets the caller mark each sent batch's wallets in the database, so a retried run doesn't
 * build that batch at all.
 */
export async function sendEmails(
  messages: readonly EmailMessage[],
  opts: { idempotency?: string; onSent?: (batch: readonly EmailMessage[]) => Promise<void> } = {},
): Promise<{ sent: number; failed: number }> {
  if (!emailEnabled() || messages.length === 0) return { sent: 0, failed: 0 };
  let sent = 0, failed = 0;
  const ordered = [...messages].sort((a, b) => (a.to < b.to ? -1 : a.to > b.to ? 1 : 0));
  for (let i = 0; i < ordered.length; i += 100) {
    const chunk = ordered.slice(i, i + 100);
    const idem: Record<string, string> = opts.idempotency
      ? { "idempotency-key": `${opts.idempotency}-${createHmac("sha256", "batch").update(chunk.map((m) => m.to).join(",")).digest("hex").slice(0, 32)}` }
      : {};
    try {
      const r = await fetch(`${RESEND}/emails/batch`, { method: "POST", headers: { ...headers(), ...idem }, body: JSON.stringify(chunk.map(payload)), signal: AbortSignal.timeout(15_000) });
      if (r.ok) {
        sent += chunk.length;
        await opts.onSent?.(chunk).catch((err) => console.error("[email] couldn't mark a sent batch:", String((err as Error)?.message ?? err).slice(0, 120)));
      }
      else {
        failed += chunk.length;
        console.error("[email] batch failed:", r.status);
      }
    } catch (err) {
      failed += chunk.length;
      console.error("[email] batch error:", String((err as Error)?.message ?? err).slice(0, 120));
    }
    if (i + 100 < messages.length) await new Promise((res) => setTimeout(res, 150));
  }
  return { sent, failed };
}
