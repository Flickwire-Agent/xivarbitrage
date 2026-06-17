import type { SaleRecord } from "@xiv-arbitrage/shared";
import {
  CartesianGrid,
  Legend,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ResponsiveContainer,
} from "recharts";

const COLORS = [
  "#5a8dd8",
  "#e76f51",
  "#2a9d8f",
  "#e9c46a",
  "#f4a261",
  "#264653",
  "#a855f7",
  "#06b6d4",
  "#84cc16",
  "#f97316",
  "#ec4899",
  "#14b8a6",
  "#8b5cf6",
  "#d946ef",
  "#22c55e",
  "#eab308",
  "#6366f1",
  "#0ea5e9",
  "#a3e635",
  "#fb923c",
  "#38bdf8",
  "#4ade80",
  "#f472b6",
  "#c084fc",
  "#2dd4bf",
  "#fbbf24",
  "#818cf8",
  "#34d399",
  "#f87171",
  "#a78bfa",
  "#6ee7b7",
  "#fde68a",
  "#93c5fd",
  "#d8b4fe",
  "#86efac",
  "#fdba74",
  "#bfdbfe",
  "#c4b5fd",
  "#a7f3d0",
  "#fecaca",
];

interface SaleHistoryChartProps {
  sales: SaleRecord[];
  visibleWorlds: Set<string>;
}

export function SaleHistoryChart({ sales, visibleWorlds }: SaleHistoryChartProps) {
  const byWorld = new Map<string, SaleRecord[]>();
  for (const sale of sales) {
    const group = byWorld.get(sale.worldName) ?? [];
    group.push(sale);
    byWorld.set(sale.worldName, group);
  }

  const worlds = [...byWorld.keys()].sort();
  const worldColor = new Map<string, string>();
  worlds.forEach((world, i) => worldColor.set(world, COLORS[i % COLORS.length]));

  return (
    <ResponsiveContainer width="100%" height={450}>
      <ScatterChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a3a4f" opacity={0.3} />
        <XAxis
          dataKey="soldAt"
          tickFormatter={(ts: string) => {
            const d = new Date(ts);
            return `${d.getDate()}/${d.getMonth() + 1}`;
          }}
          type="category"
          allowDuplicatedCategory={false}
          stroke="#687586"
          tick={{ fontSize: 12 }}
          label={{
            value: "Date",
            position: "bottom",
            offset: 10,
            style: { fill: "#687586", fontSize: 12 },
          }}
        />
        <YAxis
          dataKey="pricePerUnit"
          tickFormatter={(v: number) => v.toLocaleString()}
          stroke="#687586"
          tick={{ fontSize: 12 }}
          label={{
            value: "Gil",
            angle: -90,
            position: "insideLeft",
            style: { fill: "#687586", fontSize: 12 },
          }}
        />
        <Tooltip
          contentStyle={{
            background: "#1a2332",
            border: "1px solid #2a3a4f",
            borderRadius: 6,
            fontSize: 13,
          }}
          labelStyle={{ color: "#e1e8f0" }}
          formatter={(value: number, name: string) => [value.toLocaleString() + " gil", name]}
          labelFormatter={(label: string) => new Date(label).toLocaleString()}
        />
        <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
        {worlds.map((world) =>
          visibleWorlds.has(world) ? (
            <Scatter
              key={world}
              name={world}
              data={byWorld.get(world)}
              fill={worldColor.get(world)}
              line={false}
              shape="circle"
              opacity={0.7}
            />
          ) : null,
        )}
      </ScatterChart>
    </ResponsiveContainer>
  );
}
