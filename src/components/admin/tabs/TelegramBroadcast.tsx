"use client";
/**
 * Post to the beta testers' Telegram group AS THE BOT, from the Broadcast tab: the composer's text
 * as a message, or a poll. Gated on the server (`/api/admin/telegram`, lib/admin/serverAuth.ts),
 * because this speaks to every tester in the game's name.
 *
 * Every send asks for a typed word first: it reaches real people at once and can't be taken back
 * from here. The words go out as typed (no formatting, no link preview).
 */
import { useState } from "react";
import type { TelegramBroadcastState } from "@/app/api/admin/telegram/route";
import { useAdminApi } from "../useAdminApi";
import { GatedState } from "../GatedState";
import { AdminCard, Banner, ConfirmButton, Field, SectionLabel, TextField, Toggle, type Tone } from "../ui";
import { Info, TelegramLogo, Warning } from "../icons";

/** Telegram's limits (lib/telegram): the route checks them again, with the reason. */
const MESSAGE_MAX = 4096;

export function TelegramBroadcast({ text }: { text: string }) {
  const api = useAdminApi<TelegramBroadcastState>("/api/admin/telegram");
  const [question, setQuestion] = useState("");
  const [answers, setAnswers] = useState("");
  const [named, setNamed] = useState(false);
  const [multiple, setMultiple] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ tone: Tone; text: string } | null>(null);

  const options = answers.split("\n").map((a) => a.trim()).filter(Boolean);
  const message = text.trim();
  const send = async (body: Record<string, unknown>, what: string) => {
    setBusy(true);
    setSaid(null);
    const res = await api.send<{ ok: true }>("/api/admin/telegram", body);
    setBusy(false);
    setSaid(res.ok ? { tone: "accent", text: `${what} is in the group.` } : { tone: "error", text: `Not sent: ${res.error}` });
    return res.ok;
  };

  const title = (
    <span className="inline-flex items-center gap-1.5">
      <TelegramLogo weight="bold" size={14} /> Telegram: post as the bot
    </span>
  );
  if (api.refusal) {
    return <GatedState refusal={api.refusal} canSignIn={api.canSignIn} signIn={api.signIn} signingIn={api.signingIn} signInError={api.signInError} address={api.address} />;
  }
  if (api.data && !api.data.configured) {
    return (
      <AdminCard title={title}>
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          <span className="text-xs">The bot isn&apos;t set up on this deployment (TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, TELEGRAM_WEBHOOK_SECRET).</span>
        </Banner>
      </AdminCard>
    );
  }

  return (
    <AdminCard title={title}>
      <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
        <span className="text-xs">
          Goes to the beta testers&apos; group at once, as @lexigotchi_bot{api.data?.members ? ` (${api.data.members} members, you and the bot included)` : ""}. It
          can&apos;t be edited or taken back from here. Sent as typed: no formatting, no link preview.
        </span>
      </Banner>

      <div className="mt-4">
        <SectionLabel>the composer&apos;s text, as a message</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <ConfirmButton phrase="send" disabled={busy || !message || message.length > MESSAGE_MAX} onConfirm={() => void send({ kind: "message", text: message }, "The message")}>
            Send the message to Telegram
          </ConfirmButton>
          <span className={`text-xs font-bold ${message.length > MESSAGE_MAX ? "text-candy" : "text-ink/50"}`}>
            {message ? `${message.length}/${MESSAGE_MAX}` : "Write something in the composer above first."}
          </span>
        </div>
      </div>

      <div className="mt-5 space-y-3">
        <SectionLabel>or a poll</SectionLabel>
        <Field label="Question" hint="At most 300 characters.">
          <TextField value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300} placeholder="Which do you play on most?" />
        </Field>
        <Field label="Answers" hint="One per line. 2 to 12, each at most 100 characters.">
          <textarea
            value={answers}
            onChange={(e) => setAnswers(e.target.value)}
            rows={4}
            placeholder={"A phone\nA computer\nThe Farcaster app"}
            className="w-full resize-none rounded-xl border-[3px] border-ink bg-paper p-3 font-mono text-sm outline-none focus:bg-paper-dark/30"
          />
        </Field>
        <div className="flex flex-wrap items-center gap-4">
          <Toggle checked={named} onChange={setNamed} label="Show who chose what" />
          <Toggle checked={multiple} onChange={setMultiple} label="Allow several answers" />
        </div>
        <ConfirmButton
          phrase="send"
          disabled={busy || !question.trim() || options.length < 2}
          onConfirm={() =>
            void send({ kind: "poll", question: question.trim(), options, named, multiple }, "The poll").then((ok) => {
              if (ok) {
                setQuestion("");
                setAnswers("");
              }
            })
          }
        >
          Send the poll to Telegram
        </ConfirmButton>
      </div>

      {said && (
        <div className="mt-4">
          <Banner tone={said.tone} icon={<Info weight="bold" size={14} />}>
            <span className="text-xs">{said.text}</span>
          </Banner>
        </div>
      )}
    </AdminCard>
  );
}
