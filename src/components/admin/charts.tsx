"use client";
/**
 * Cel-styled recharts wrappers for the admin dashboard, matching the marketing /economy charts'
 * look (ink axes, faint grid, bordered tooltip) so visualizations feel native to Lexigotchi.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const INK = "#1b1714";
const compact = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1000)}k` : `${Math.round(n)}`;

export interface LineSpec {
  key: string;
  color: string;
  label: string;
}

export function TrendChart<T extends { day: number }>({
  data,
  lines,
  title,
  height = 220,
}: {
  data: T[];
  lines: LineSpec[];
  title: string;
  height?: number;
}) {
  return (
    <div className="cel rounded-2xl bg-paper p-3">
      <div className="mb-2 font-display text-sm font-bold">{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={INK} strokeOpacity={0.08} />
          <XAxis dataKey="day" tick={{ fontSize: 11 }} stroke={INK} tickFormatter={(d) => `${d + 1}`} />
          <YAxis tick={{ fontSize: 11 }} stroke={INK} tickFormatter={compact} width={42} />
          <Tooltip
            formatter={(v: number) => Math.round(v).toLocaleString()}
            labelFormatter={(d) => `day ${Number(d) + 1}`}
            contentStyle={{ border: `2px solid ${INK}`, borderRadius: 6, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((l) => (
            <Line key={l.key} type="monotone" dataKey={l.key} name={l.label} stroke={l.color} strokeWidth={2} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Horizontal-ish categorical bar chart (e.g. per-letter cap consumption). */
export function BarsChart({
  data,
  title,
  color = "#2a9d8f",
  height = 240,
  colorFor,
}: {
  data: { label: string; value: number }[];
  title: string;
  color?: string;
  height?: number;
  colorFor?: (d: { label: string; value: number }) => string;
}) {
  return (
    <div className="cel rounded-2xl bg-paper p-3">
      <div className="mb-2 font-display text-sm font-bold">{title}</div>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 4 }}>
          <CartesianGrid stroke={INK} strokeOpacity={0.08} vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} stroke={INK} interval={0} />
          <YAxis tick={{ fontSize: 11 }} stroke={INK} tickFormatter={compact} width={42} />
          <Tooltip
            formatter={(v: number) => Math.round(v).toLocaleString()}
            contentStyle={{ border: `2px solid ${INK}`, borderRadius: 6, fontSize: 12 }}
          />
          <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]}>
            {colorFor && data.map((d, i) => <Cell key={i} fill={colorFor(d)} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
