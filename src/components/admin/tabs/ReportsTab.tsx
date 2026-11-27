"use client";
/**
 * Reports — what beta testers told the bot with `/bug` (lib/telegramReports), newest first. Gated
 * on the server (useAdminApi): these are testers' own words from a private group, with their
 * Telegram names.
 *
 * Marking a report FIXED makes the bot reply to it where it was filed, once, with an optional note.
 * Closing one tells nobody. "Open as an issue" starts a GitHub issue with the report's words and
 * number and WITHOUT the reporter's name: the repository is public.
 */
import { useEffect, useMemo, useState } from "react";
import { issueUrl, type ReportMoved, type ReportRow, type ReportsPayload } from "@/lib/admin/reportRows";
import { useAdminApi } from "../useAdminApi";
import { GatedState } from "../GatedState";
import { AdminCard, Banner, ErrorState, RefreshButton, Spinner, StatusBadge, TextField, Toggle, type Tone } from "../ui";
import { Info, TelegramLogo, Warning } from "../icons";
import { ago, whenUtc } from "./PlayersTab";

const STATUS_TONE: Record<ReportRow["status"], Tone> = { open: "warning", fixed: "ok", closed: "accent" };

export function ReportsTab() {
  const api = useAdminApi<ReportsPayload>("/api/admin/reports");
  const [showDone, setShowDone] = useState(false);
  /** Rows changed here since the last load, by id. */
  const [moved, setMoved] = useState<Record<number, ReportRow>>({});
  const data = api.data;
  useEffect(() => setMoved({}), [data]);
  const rows = useMemo(() => (data?.reports ?? []).map((r) => moved[r.id] ?? r), [data, moved]);
  const open = rows.filter((r) => r.status === "open").length;
  const shown = rows.filter((r) => showDone || r.status === "open");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <TelegramLogo weight="bold" size={18} />
          <h2 className="font-display text-lg font-extrabold">Reports</h2>
          {data?.ready && <span className="text-xs text-ink/50">{open} open · {rows.length} in all</span>}
        </div>
        <RefreshButton onClick={() => api.reload(true)} loading={api.loading} />
      </div>

      {api.refusal ? (
        <GatedState refusal={api.refusal} canSignIn={api.canSignIn} signIn={api.signIn} signingIn={api.signingIn} signInError={api.signInError} address={api.address} />
      ) : api.loading && !data ? (
        <Spinner />
      ) : api.error && !data ? (
        <ErrorState msg={api.error} onRetry={() => api.reload(true)} />
      ) : data && !data.ready ? (
        <Banner tone="warning" icon={<Warning weight="bold" size={14} />}>
          <span className="text-xs">
            Reports aren&apos;t set up on this deployment yet: migration <code>0019_tester_reports</code> hasn&apos;t run. Until it does, the bot tells a tester it
            couldn&apos;t save their report.
          </span>
        </Banner>
      ) : data ? (
        <>
          <Banner tone="ok" icon={<Info weight="bold" size={14} />}>
            <span className="text-xs">
              Testers file these in Telegram with <code>/bug what went wrong</code>, in the group or in a private chat with the bot. Only this console shows them.
              Marking one fixed makes the bot reply to it, once.
            </span>
          </Banner>
          <div className="flex justify-end">
            <Toggle checked={showDone} onChange={setShowDone} label="Show fixed and closed" />
          </div>
          {shown.length === 0 ? (
            <AdminCard>
              <p className="text-sm text-ink/60">{rows.length === 0 ? "No reports yet." : "No open reports."}</p>
            </AdminCard>
          ) : (
            <div className="space-y-3">
              {shown.map((r) => (
                <ReportCard key={r.id} report={r} api={api} onMoved={(row) => setMoved((m) => ({ ...m, [row.id]: row }))} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}

function ReportCard({ report, api, onMoved }: { report: ReportRow; api: ReturnType<typeof useAdminApi<ReportsPayload>>; onMoved: (row: ReportRow) => void }) {
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  /** What the last action came to, in a sentence. */
  const [said, setSaid] = useState<{ tone: Tone; text: string } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  // The screenshot is held as an object URL: let it go when the card goes.
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo)), [photo]);

  const move = async (status: ReportRow["status"]) => {
    setBusy(true);
    setSaid(null);
    const res = await api.send<ReportMoved>("/api/admin/reports", { id: report.id, status, note: status === "fixed" ? note : undefined });
    setBusy(false);
    if (!res.ok) return setSaid({ tone: "error", text: `Not saved: ${res.error}.` });
    onMoved(res.report);
    if (res.told === true) setSaid({ tone: "ok", text: "Marked fixed, and the bot told the reporter." });
    else if (res.told === false) setSaid({ tone: "warning", text: `Marked fixed, but the bot couldn’t tell the reporter: ${res.tellError ?? "the message was not sent"}` });
    else setSaid(null);
    if (status === "fixed") setNote("");
  };
  const showPhoto = async () => {
    setBusy(true);
    const blob = await api.fetchBlob(`/api/admin/reports/photo?id=${report.id}`);
    setBusy(false);
    if (!blob) return setSaid({ tone: "warning", text: "The screenshot couldn’t be fetched from Telegram." });
    setPhoto(URL.createObjectURL(blob));
  };

  return (
    <AdminCard
      title={
        <span className="inline-flex flex-wrap items-center gap-2">
          <span>#{report.id}</span>
          <StatusBadge tone={STATUS_TONE[report.status]}>{report.status}</StatusBadge>
          <span className="text-xs font-normal text-ink/55">
            {report.reporter} · {whenUtc(report.at)} ({ago(report.at, Date.now())}){report.private ? " · in a private chat" : ""}
          </span>
        </span>
      }
    >
      <p className="whitespace-pre-wrap break-words text-sm">{report.text}</p>
      {/* A tester's own screenshot, fetched by the bot: never a public address. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {photo && <img src={photo} alt={`The screenshot sent with report ${report.id}`} className="mt-3 max-h-[28rem] rounded-xl border-2 border-ink" />}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        {report.hasPhoto && !photo && (
          <button onClick={showPhoto} disabled={busy} className="rounded-lg border-2 border-ink bg-paper px-2.5 py-1 font-bold disabled:opacity-40">
            Show the screenshot
          </button>
        )}
        {report.link && (
          <a href={report.link} target="_blank" rel="noopener noreferrer" className="rounded-lg border-2 border-ink bg-paper px-2.5 py-1 font-bold">
            Open in Telegram
          </a>
        )}
        <a href={issueUrl(report)} target="_blank" rel="noopener noreferrer" className="rounded-lg border-2 border-ink bg-paper px-2.5 py-1 font-bold" title="The repository is public: the issue carries the report's words and number, not the reporter's name.">
          Open as a public GitHub issue
        </a>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {report.status === "open" ? (
          <>
            <div className="min-w-[14rem] flex-1">
              <TextField value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="A note for the reporter (optional)" />
            </div>
            <button
              onClick={() => move("fixed")}
              disabled={busy}
              className="rounded-xl border-[3px] border-ink bg-teal px-3 py-1.5 text-sm font-extrabold text-paper shadow-[3px_3px_0_#1b1714] active:translate-x-[2px] active:translate-y-[2px] active:shadow-none disabled:opacity-40"
            >
              Mark fixed and tell them
            </button>
            <button onClick={() => move("closed")} disabled={busy} className="rounded-xl border-[3px] border-ink bg-paper px-3 py-1.5 text-sm font-extrabold disabled:opacity-40">
              Close quietly
            </button>
          </>
        ) : (
          <button onClick={() => move("open")} disabled={busy} className="rounded-xl border-[3px] border-ink bg-paper px-3 py-1.5 text-sm font-extrabold disabled:opacity-40">
            Reopen
          </button>
        )}
      </div>
      {said && (
        <div className="mt-3">
          <Banner tone={said.tone} icon={<Info weight="bold" size={14} />}>
            <span className="text-xs">{said.text}</span>
          </Banner>
        </div>
      )}
    </AdminCard>
  );
}
