"use client";

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
  CartesianGrid,
} from "recharts";

export interface ChartDay {
  day: number;
  pool: number;
  jackpot: number;
  burnedTotal: number;
  treasuryTotal: number;
  totalClaims: number;
  uppercaseWords: number;
  distributionToday: number;
}

const INK = "#1b1714";
const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`);

function Chart({
  data,
  lines,
  title,
}: {
  data: ChartDay[];
  lines: { key: keyof ChartDay; color: string; label: string }[];
  title: string;
}) {
  return (
    <div className="cel rounded-lg bg-paper p-3">
      <div className="mb-2 font-display text-sm font-bold">{title}</div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={INK} strokeOpacity={0.08} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke={INK} tickFormatter={(d) => `${d + 1}`} />
          <YAxis tick={{ fontSize: 11 }} stroke={INK} tickFormatter={fmt} width={40} />
          <Tooltip
            formatter={(v: number) => Math.round(v).toLocaleString()}
            labelFormatter={(d) => `day ${Number(d) + 1}`}
            contentStyle={{ border: `2px solid ${INK}`, borderRadius: 6, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l) => (
            <Line
              key={String(l.key)}
              type="monotone"
              dataKey={l.key}
              name={l.label}
              stroke={l.color}
              strokeWidth={2}
              dot={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function EconomyCharts({ days }: { days: ChartDay[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Chart
        title="Rewards Pool & Jackpot ($WORD)"
        data={days}
        lines={[
          { key: "pool", color: "#2a9d8f", label: "Rewards Pool" },
          { key: "jackpot", color: "#e0a93b", label: "Jackpot pot" },
        ]}
      />
      <Chart
        title="Cumulative burn vs treasury ($WORD)"
        data={days}
        lines={[
          { key: "burnedTotal", color: "#d8463f", label: "Burned" },
          { key: "treasuryTotal", color: "#7b4ea3", label: "Treasury" },
        ]}
      />
      <Chart
        title="Collection progress"
        data={days}
        lines={[
          { key: "totalClaims", color: INK, label: "Words claimed" },
          { key: "uppercaseWords", color: "#e0a93b", label: "UPPERCASE words" },
        ]}
      />
      <Chart
        title="Daily yield distributed ($WORD)"
        data={days}
        lines={[{ key: "distributionToday", color: "#2a9d8f", label: "Yield / day" }]}
      />
    </div>
  );
}
