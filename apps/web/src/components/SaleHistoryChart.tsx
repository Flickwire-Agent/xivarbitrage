import { useMemo } from "react";
import type { SaleRecord } from "@xiv-arbitrage/shared";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SCATTER_COLORS = [
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

const DC_LINE_COLORS = ["#d62828", "#003049", "#7209b7", "#f77f00", "#1a936f", "#560bad"];

function safeString(v: unknown): string {
  return String(v ?? "");
}

function computeDailyAverages(dcSales: SaleRecord[]): { soldAt: string; pricePerUnit: number }[] {
  const byDate = new Map<string, number[]>();
  for (const sale of dcSales) {
    const day = sale.soldAt.slice(0, 10);
    const prices = byDate.get(day) ?? [];
    prices.push(sale.pricePerUnit);
    byDate.set(day, prices);
  }

  return [...byDate.entries()]
    .map(([day, prices]) => ({
      soldAt: day,
      pricePerUnit: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    }))
    .sort((a, b) => a.soldAt.localeCompare(b.soldAt));
}

interface SaleHistoryChartProps {
  sales: SaleRecord[];
  visibleWorlds: Set<string>;
  worldIdToDc: Record<number, string>;
}

export function SaleHistoryChart({ sales, visibleWorlds, worldIdToDc }: SaleHistoryChartProps) {
  const { byWorld, worlds, worldColor, dcs, dcDailyAverages, dcColor } = useMemo(() => {
    const nextByWorld = new Map<string, SaleRecord[]>();
    for (const sale of sales) {
      const group = nextByWorld.get(sale.worldName) ?? [];
      group.push(sale);
      nextByWorld.set(sale.worldName, group);
    }

    const nextWorlds = [...nextByWorld.keys()].sort();
    const nextWorldColor = new Map<string, string>();
    nextWorlds.forEach((world, i) =>
      nextWorldColor.set(world, SCATTER_COLORS[i % SCATTER_COLORS.length]!),
    );

    const nextByDc = new Map<string, SaleRecord[]>();
    for (const sale of sales) {
      const dc = worldIdToDc[sale.worldId];
      if (!dc) continue;
      const group = nextByDc.get(dc) ?? [];
      group.push(sale);
      nextByDc.set(dc, group);
    }

    const nextDcs = [...nextByDc.keys()].sort();
    const nextDcDailyAverages = new Map<string, ReturnType<typeof computeDailyAverages>>();
    for (const dc of nextDcs) {
      nextDcDailyAverages.set(dc, computeDailyAverages(nextByDc.get(dc)!));
    }

    const nextDcColor = new Map<string, string>();
    nextDcs.forEach((dc, i) => nextDcColor.set(dc, DC_LINE_COLORS[i % DC_LINE_COLORS.length]!));

    return {
      byWorld: nextByWorld,
      worlds: nextWorlds,
      worldColor: nextWorldColor,
      dcs: nextDcs,
      dcDailyAverages: nextDcDailyAverages,
      dcColor: nextDcColor,
    };
  }, [sales, worldIdToDc]);

  return (
    <div
      role="img"
      aria-label="Sale history chart showing individual world sales as scatter points and data center daily average prices as lines"
    >
      <ResponsiveContainer width="100%" height={450}>
        <ComposedChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3a4f" opacity={0.3} />
          <XAxis
            dataKey="soldAt"
            tickFormatter={(ts: string) => {
              const d = new Date(ts);
              return `${d.getDate()}/${d.getMonth() + 1}`;
            }}
            type="category"
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
            formatter={(value, name) => [safeString(value) + " gil", safeString(name)]}
            labelFormatter={(label) => new Date(safeString(label)).toLocaleString()}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {dcs.map((dc) => (
            <Line
              key={dc}
              name={`${dc} avg`}
              data={dcDailyAverages.get(dc)}
              dataKey="pricePerUnit"
              stroke={dcColor.get(dc)}
              strokeWidth={2}
              dot={false}
              connectNulls
            />
          ))}
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
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
