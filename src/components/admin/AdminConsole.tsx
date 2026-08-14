"use client";
/**
 * The operator console shell — modeled on the Griddle admin dashboard: sectioned tab groups
 * (Analytics · Operations · Settings), each tab self-contained, with a persistent status strip and
 * keyboard shortcuts (LHAW parity). Rendered in Lexigotchi's cel / aged-paper design language.
 */
import { useEffect, useState, type ReactNode } from "react";
import { StatusStrip } from "./StatusStrip";
import {
  ChartLineUp,
  Faders,
  Gauge,
  GearSix,
  ListChecks,
  Megaphone,
  BellRinging,
  RocketLaunch,
  ShieldCheck,
  Stack,
  Wallet,
  Wrench,
} from "./icons";
import { PulseTab } from "./tabs/PulseTab";
import { EconomyTab } from "./tabs/EconomyTab";
import { SupplyTab } from "./tabs/SupplyTab";
import { LaunchTab } from "./tabs/LaunchTab";
import { TreasuryTab } from "./tabs/TreasuryTab";
import { ParametersTab } from "./tabs/ParametersTab";
import { KeeperTab } from "./tabs/KeeperTab";
import { AccessTab } from "./tabs/AccessTab";
import { DeploymentsTab } from "./tabs/DeploymentsTab";
import { BroadcastTab } from "./tabs/BroadcastTab";
import { NotificationsTab } from "./tabs/NotificationsTab";
import { useWordPrice } from "@/lib/oracle/useWordPrice";

type TabId =
  | "pulse"
  | "economy"
  | "supply"
  | "launch"
  | "treasury"
  | "parameters"
  | "keeper"
  | "access"
  | "deployments"
  | "broadcast"
  | "notifications";

interface TabDef {
  id: TabId;
  label: string;
  section: "Analytics" | "Operations" | "Settings";
  icon: ReactNode;
  render: () => ReactNode;
}

const TABS: TabDef[] = [
  { id: "pulse", label: "Pulse", section: "Analytics", icon: <Gauge weight="bold" size={15} />, render: () => <PulseTab /> },
  { id: "economy", label: "Economy", section: "Analytics", icon: <ChartLineUp weight="bold" size={15} />, render: () => <EconomyTab /> },
  { id: "supply", label: "Supply", section: "Analytics", icon: <Stack weight="bold" size={15} />, render: () => <SupplyTab /> },
  { id: "launch", label: "Launch", section: "Operations", icon: <RocketLaunch weight="bold" size={15} />, render: () => <LaunchTab /> },
  { id: "treasury", label: "Treasury & Pools", section: "Operations", icon: <Wallet weight="bold" size={15} />, render: () => <TreasuryTab /> },
  { id: "parameters", label: "Parameters", section: "Operations", icon: <Faders weight="bold" size={15} />, render: () => <ParametersTab /> },
  { id: "keeper", label: "Keeper", section: "Operations", icon: <Wrench weight="bold" size={15} />, render: () => <KeeperTab /> },
  { id: "access", label: "Access & Safety", section: "Operations", icon: <ShieldCheck weight="bold" size={15} />, render: () => <AccessTab /> },
  { id: "deployments", label: "Deployments", section: "Settings", icon: <ListChecks weight="bold" size={15} />, render: () => <DeploymentsTab /> },
  { id: "broadcast", label: "Broadcast", section: "Settings", icon: <Megaphone weight="bold" size={15} />, render: () => <BroadcastTab /> },
  { id: "notifications", label: "Notifications", section: "Settings", icon: <BellRinging weight="bold" size={15} />, render: () => <NotificationsTab /> },
];

/** Digits 1–9 and 0 map onto the first ten tabs; anything past that is mouse-only. */
const SHORTCUT_MAX = 10;

const SECTIONS = ["Analytics", "Operations", "Settings"] as const;

export function AdminConsole({ operator }: { operator: { label: string; kind: "fid" | "wallet" | "dev" } }) {
  const [active, setActive] = useState<TabId>("pulse");
  // Live $WORD peg — every USD→wei the console builds (TxPlan, Treasury, Launch ctor args) reads
  // the peg cell at call time, so this top-level mount is what prices them off the market.
  useWordPrice();

  // Keyboard shortcuts 1–9,0 → tab order (skip when typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return; // don't hijack Cmd/Ctrl/Alt+number
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      // Only ten digits exist, so only the first ten tabs get a shortcut. Guarding on SHORTCUT_MAX
      // rather than TABS.length keeps key "0" bound to the tenth tab as more tabs are added — the
      // eleventh would otherwise be labelled with the tenth's shortcut and be unreachable anyway.
      const n = e.key === "0" ? 10 : Number(e.key);
      if (n >= 1 && n <= Math.min(SHORTCUT_MAX, TABS.length)) setActive(TABS[n - 1].id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const activeTab = TABS.find((t) => t.id === active)!;

  return (
    <div className="min-h-screen bg-paper">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Lexigotchi · Operator</h1>
            <p className="mt-1 text-sm text-ink/55">
              Owner / operator console ·{" "}
              <span className="font-mono">
                {operator.kind === "dev" ? "dev-open" : operator.label}
              </span>
            </p>
          </div>
          <a href="/play" className="rounded-lg border-2 border-ink bg-paper px-3 py-1.5 text-sm font-bold active:translate-y-[1px]">
            ▶ Open game
          </a>
        </header>

        <StatusStrip />

        {SECTIONS.map((section) => {
          const tabs = TABS.filter((t) => t.section === section);
          return (
            <div key={section} className="mb-4">
              <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-ink/40">{section}</div>
              <div className="flex flex-wrap gap-2">
                {tabs.map((t) => {
                  const idx = TABS.indexOf(t) + 1;
                  const on = t.id === active;
                  return (
                    <button
                      key={t.id}
                      onClick={() => setActive(t.id)}
                      className={`inline-flex items-center gap-1.5 rounded-xl border-[3px] border-ink px-3 py-1.5 text-sm font-extrabold shadow-[2px_2px_0_#1b1714] transition-all active:translate-x-[2px] active:translate-y-[2px] active:shadow-none ${
                        on ? "bg-candy text-paper" : "bg-paper text-ink"
                      }`}
                      title={idx <= SHORTCUT_MAX ? `${t.label} (${idx === 10 ? 0 : idx})` : t.label}
                    >
                      {t.icon}
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="mt-6">{activeTab.render()}</div>
      </div>
    </div>
  );
}
