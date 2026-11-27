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
import { EMAIL_MARK } from "@/lib/cardArt/logo";

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

/**
 * The email's look: the game's card, as little of it as says "this is from the game" (starl3xx,
 * 2026-11-26: "make sure the email design is minimal and follows our most recent design language";
 * decisions.md #34, #35, #37). The card's own paper on the game's page; the frame as two fine lines
 * in the card's ink, a rule and a dotted line just inside it; the wordmark in the card's serif
 * capitals; facts as the back's ledger (a name, a row of dots, a value in the serif). Words and
 * sentences stay in the sans, as words do on a card.
 *
 * What an email can't have, it doesn't try for: no picture, no shipped font (stacks only: the
 * card's serif is Source Serif 4 where a device happens to have it, then Iowan Old Style, then
 * Palatino, then Georgia: a mail program loads no font, so an email can't be held to the game's), no dark
 * variant (it says "light only", so a client that honors it leaves the paper alone). Tables and
 * inline styles, because mail clients read little else. One button, in ink.
 */
const PAGE = "#f4ead2"; // the game's page (tailwind paper)
const CARD = "#fcf7ea"; // lib/cardArt/looks CARD_PAPER
const INK = "#1b1714";
const LINE = "#4a3a2c"; // the Common card's frame ink (lib/cardArt/looks CARD_LOOKS)
const SOFT = "#5f5549"; // body text: ink at about 70% on the card's paper
const SERIF = "'Source Serif 4','Iowan Old Style','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** A fact for the ledger: its name, and its value. */
export type EmailFact = readonly [name: string, value: string];

function ledger(facts: readonly EmailFact[]): string {
  if (facts.length === 0) return "";
  const rows = facts
    .map(
      ([name, value]) =>
        `<tr><td style="padding:5px 0;font:14px/1.3 ${SANS};color:${SOFT};white-space:nowrap">${esc(name)}</td>` +
        `<td width="100%" style="padding:5px 8px"><div style="border-bottom:1px dotted ${LINE};height:10px;line-height:10px;font-size:1px">&nbsp;</div></td>` +
        `<td align="right" style="padding:5px 0;font:16px/1.3 ${SERIF};color:${INK};white-space:nowrap">${esc(value)}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows}</table>`;
}

interface Layout {
  title: string;
  /** What the inbox shows after the subject. */
  preview: string;
  /** The message: trusted HTML, built here. */
  body: string;
  /** Under the card: why this came, and the way out. Trusted HTML. */
  footer: string;
}

function layout(m: Layout): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>${esc(m.title)}</title></head>
<body style="margin:0;padding:0;background:${PAGE};color:${INK}">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE}">${esc(m.preview)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE}"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:${CARD};border:1px solid ${LINE};border-radius:10px"><tr><td style="padding:5px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px dotted ${LINE};border-radius:6px"><tr><td style="padding:24px 24px 26px">
<img src="${SITE}${EMAIL_MARK.path}" width="${EMAIL_MARK.width}" height="${EMAIL_MARK.height}" alt="LEXIGOTCHI" style="display:block;border:0;outline:none;text-decoration:none;font:700 12px/${EMAIL_MARK.height}px ${SERIF};letter-spacing:3px;color:${LINE}">
<div style="border-top:1px solid ${LINE};opacity:.35;height:1px;line-height:1px;font-size:1px;margin:14px 0 20px">&nbsp;</div>
<h1 style="margin:0 0 10px;font:800 22px/1.25 ${SANS};color:${INK}">${esc(m.title)}</h1>
${m.body}
</td></tr></table>
</td></tr></table>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px"><tr><td align="center" style="padding:14px 8px 0;font:12px/1.5 ${SANS};color:${SOFT}">${m.footer}</td></tr></table>
</td></tr></table>
</body></html>`;
}

const paragraph = (text: string) => `<p style="margin:0 0 20px;font:16px/1.5 ${SANS};color:${SOFT}">${esc(text)}</p>`;
const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:${INK};color:${CARD};font:700 15px/1 ${SANS};text-decoration:none;border-radius:8px;padding:12px 20px">${esc(label)}</a>`;
const footLink = (href: string, label: string) => `<a href="${href}" style="color:${SOFT};text-decoration:underline">${esc(label)}</a>`;

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
  // The code is set as a card sets its number: in the serif, large, inside a ruled box.
  const body = `${paragraph("Type this code in Lexigotchi to confirm your email. It works for 10 minutes.")}
<div style="display:inline-block;border:1px solid ${LINE};border-radius:6px;padding:12px 16px 12px 22px;font:700 32px/1 ${SERIF};letter-spacing:6px;color:${INK}">${esc(code)}</div>`;
  return {
    to,
    subject: `Your Lexigotchi code: ${code}`,
    html: layout({ title: "Confirm your email", preview: `Your code is ${code}. It works for 10 minutes.`, body, footer: "If you didn’t ask for this, ignore it. Nothing changes." }),
    text: `Your Lexigotchi code is ${code}. It works for 10 minutes.\n\nIf you didn’t ask for this, ignore it.`,
  };
}

/**
 * A reminder, from the same { title, body } the Farcaster and browser channels send. `facts` are a
 * receipt's ledger (what sold, for how much), shown as the card's back shows its facts.
 */
export function reminderEmail(to: string, address: string, note: { title: string; body: string }, facts: readonly EmailFact[] = []): EmailMessage | null {
  const a = address.toLowerCase();
  const unsub = unsubscribeUrl(address);
  if (!unsub) return null; // never send a reminder without a working way out
  const play = `${SITE}/play`;
  const body = `${paragraph(note.body)}${ledger(facts)}${button(play, "Open Lexigotchi")}`;
  const footer = `You get this because you turned on email reminders in your Lexigotchi profile. Choose which ones, and how often, there, under “What to tell me”, or ${footLink(unsub, "unsubscribe")} from all of them.`;
  const factLines = facts.map(([name, value]) => `${name}: ${value}`).join("\n");
  return {
    address: a,
    to,
    subject: note.title,
    html: layout({ title: note.title, preview: note.body, body, footer }),
    text: `${note.title}\n\n${note.body}\n\n${factLines ? `${factLines}\n\n` : ""}Open Lexigotchi: ${play}\n\nChoose which reminders you get, and how often, in your profile, under “What to tell me”.\nUnsubscribe from all of them: ${unsub}`,
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
