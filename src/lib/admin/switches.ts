/**
 * Every feature switch this deployment holds, as the operator console shows it: on or off, and the
 * settings still missing for each one that's off. Server-only (it reads the environment). Booleans
 * and setting NAMES only: never a value.
 *
 * It calls the features' own checks where they are safe to import (profilesEnabled, xEnabled,
 * emailEnabled, telegramConfigured, getRedis), so the console can't disagree with the app. Two are
 * restated instead, on purpose: `notify/send.ts` and `notify/webPush.ts` THROW at import when armed
 * without their keys (right for the senders, wrong for a status page that exists to show exactly
 * that). Their rules are three lines each; keep them in step with send.ts and webPushIsActive.
 */
import { profileSecret, profilesEnabled } from "@/lib/profile/session";
import { xEnabled } from "@/lib/profile/x";
import { emailEnabled } from "@/lib/notify/email";
import { telegramConfigured } from "@/lib/telegram";
import { getRedis } from "@/lib/redis";

export interface Switch {
  key: string;
  label: string;
  on: boolean;
  /** One line: what it does, or what's left. */
  detail: string;
  /** Setting names still needed for it to be on. */
  missing: string[];
}

const set = (name: string) => Boolean(process.env[name]?.trim());
const is = (name: string, value: string) => process.env[name] === value;
const need = (pairs: [boolean, string][]) => pairs.filter(([ok]) => !ok).map(([, name]) => name);

export function farcasterNotifySwitch(): Switch {
  const isProd = process.env.NODE_ENV === "production";
  const missing = need([
    [isProd, "a production deployment"],
    [is("NOTIFICATIONS_ENABLED", "true"), "NOTIFICATIONS_ENABLED=true"],
    [set("NEYNAR_API_KEY"), "NEYNAR_API_KEY"],
  ]);
  return {
    key: "farcasterNotify",
    label: "Farcaster notifications",
    on: missing.length === 0,
    detail: "Hunger, daily-letter, and jackpot pushes to players who added the mini app (sent by Neynar).",
    missing,
  };
}

export function webPushSwitch(): Switch & { toggleShown: boolean } {
  const isProd = process.env.NODE_ENV === "production";
  const missing = need([
    [set("NEXT_PUBLIC_VAPID_PUBLIC_KEY"), "NEXT_PUBLIC_VAPID_PUBLIC_KEY"],
    [set("VAPID_PRIVATE_KEY"), "VAPID_PRIVATE_KEY"],
    [is("WEB_PUSH_ENABLED", "true"), "WEB_PUSH_ENABLED=true"],
    [isProd, "a production deployment"],
  ]);
  return {
    key: "webPush",
    label: "Browser push",
    on: missing.length === 0,
    toggleShown: set("NEXT_PUBLIC_VAPID_PUBLIC_KEY"),
    detail: "Reminders for wallet-only web players Farcaster can’t reach. The toggle shows once the public key is set.",
    missing,
  };
}

export function emailSwitch(): Switch {
  const missing = need([
    [profilesEnabled(), "profiles on (see Profiles)"],
    [is("EMAIL_ENABLED", "true"), "EMAIL_ENABLED=true"],
    [set("RESEND_API_KEY"), "RESEND_API_KEY"],
    [set("EMAIL_FROM"), "EMAIL_FROM"],
  ]);
  return {
    key: "email",
    label: "Email reminders",
    on: emailEnabled(),
    detail: "A confirmed email gets hunger, daily-letter, and jackpot reminders (Resend), with one-click unsubscribe.",
    missing,
  };
}

export function featureSwitches(): Switch[] {
  const profilesMissing = need([
    [is("PROFILES_ENABLED", "true"), "PROFILES_ENABLED=true"],
    [profileSecret() !== null, "PROFILE_SESSION_SECRET (32+ characters)"],
    [set("DATABASE_URL"), "DATABASE_URL"],
  ]);
  return [
    {
      key: "profiles",
      label: "Profiles and wallet sessions",
      on: profilesEnabled(),
      detail: "Name and picture, linked wallets, and the wallet sign-in this console uses for Players and System.",
      missing: profilesMissing,
    },
    {
      key: "x",
      label: "Link X",
      on: xEnabled(),
      detail: "A linked X account names the wallet and, at 90+ days old, unlocks the free letters (a pack of 5 plus 10 daily letters).",
      missing: need([
        [profilesEnabled(), "profiles on (see Profiles)"],
        [set("X_CLIENT_ID"), "X_CLIENT_ID"],
        [set("X_CLIENT_SECRET"), "X_CLIENT_SECRET"],
      ]),
    },
    emailSwitch(),
    farcasterNotifySwitch(),
    webPushSwitch(),
    {
      key: "neynar",
      label: "Farcaster data (Neynar)",
      on: set("NEYNAR_API_KEY"),
      detail: "Names and pictures by wallet, share-cast checks, and the notification sender.",
      missing: need([[set("NEYNAR_API_KEY"), "NEYNAR_API_KEY"]]),
    },
    {
      key: "telegram",
      label: "Beta group bot",
      on: telegramConfigured(),
      detail: "@lexigotchi_bot welcomes new members. Release posts come from the GitHub workflow’s own secrets.",
      missing: need([
        [set("TELEGRAM_BOT_TOKEN"), "TELEGRAM_BOT_TOKEN"],
        [set("TELEGRAM_CHAT_ID"), "TELEGRAM_CHAT_ID"],
        [set("TELEGRAM_WEBHOOK_SECRET"), "TELEGRAM_WEBHOOK_SECRET"],
      ]),
    },
    {
      key: "rateLimits",
      label: "Rate limits (Upstash)",
      on: getRedis() !== null,
      detail: "Without it every limit fails open: sign-in, push, sightings, and campaign routes are unbounded.",
      missing: getRedis() ? [] : ["KV_REST_API_URL + KV_REST_API_TOKEN (or the UPSTASH_REDIS_REST_* or lexigotchi_KV_REST_API_* pair)"],
    },
    {
      key: "paymaster",
      label: "Gas sponsorship",
      on: is("NEXT_PUBLIC_PAYMASTER_ENABLED", "1") && set("PAYMASTER_URL"),
      detail: "Sponsors gas for smart wallets that support it (never the swap).",
      missing: need([
        [is("NEXT_PUBLIC_PAYMASTER_ENABLED", "1"), "NEXT_PUBLIC_PAYMASTER_ENABLED=1"],
        [set("PAYMASTER_URL"), "PAYMASTER_URL"],
      ]),
    },
    {
      key: "cron",
      label: "Scheduled jobs",
      on: set("CRON_SECRET"),
      detail: "The keeper (00:05 UTC), the daily-letter reminder, and the share reconcile. Production refuses them without the secret.",
      missing: need([[set("CRON_SECRET"), "CRON_SECRET"]]),
    },
  ];
}
