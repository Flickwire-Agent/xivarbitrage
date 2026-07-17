import { useMemo } from "react";
import type { SaleRecord } from "@xiv-arbitrage/shared";
import {
  Area,
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
import {
  getDataCenterBandColor,
  getDataCenterLineColor,
  getDataCenterWorldColor,
} from "../lib/chartColors.js";

type ChartSaleRecord = SaleRecord & { soldAtMs: number };

interface DailyAveragePoint {
  soldAt: string;
  soldAtMs: number;
  pricePerUnit: number;
  quartileRange: [number, number];
}

function safeString(v: unknown): string {
  return String(v ?? "");
}

function quantile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 0) return 0;
  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) return sortedValues[lower]!;
  return sortedValues[lower]! * (1 - weight) + sortedValues[upper]! * weight;
}

function computeDailyAverages(dcSales: ChartSaleRecord[]): DailyAveragePoint[] {
  const byDate = new Map<string, { prices: number[]; timestamps: number[] }>();
  for (const sale of dcSales) {
    const day = sale.soldAt.slice(0, 10);
    const group = byDate.get(day) ?? { prices: [], timestamps: [] };
    group.prices.push(sale.pricePerUnit);
    group.timestamps.push(sale.soldAtMs);
    byDate.set(day, group);
  }

  return [...byDate.entries()]
    .map(([day, { prices, timestamps }]) => {
      const sortedPrices = [...prices].sort((a, b) => a - b);
      return {
        soldAt: day,
        soldAtMs: Math.round(timestamps.reduce((a, b) => a + b, 0) / timestamps.length),
        pricePerUnit: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
        quartileRange: [
          Math.round(quantile(sortedPrices, 0.25)),
          Math.round(quantile(sortedPrices, 0.75)),
        ] as [number, number],
      };
    })
    .sort((a, b) => a.soldAtMs - b.soldAtMs);
}

function formatDateTick(ts: number): string {
  const d = new Date(ts);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

interface SaleHistoryChartProps {
  sales: SaleRecord[];
  visibleWorlds: Set<string>;
  visibleDcs: Set<string>;
  worldIdToDc: Record<number, string>;
  worldToDc: Map<string, string>;
}

export function SaleHistoryChart({
  sales,
  visibleWorlds,
  visibleDcs,
  worldIdToDc,
  worldToDc,
}: SaleHistoryChartProps) {
  const chartSales = useMemo(
    () =>
      sales
        .map((sale) => ({ ...sale, soldAtMs: new Date(sale.soldAt).getTime() }))
        .filter((sale) => Number.isFinite(sale.soldAtMs)),
    [sales],
  );

  const { byWorld, worlds, dcs, byDc, xDomain } = useMemo(() => {
    const nextByWorld = new Map<string, ChartSaleRecord[]>();
    for (const sale of chartSales) {
      const group = nextByWorld.get(sale.worldName) ?? [];
      group.push(sale);
      nextByWorld.set(sale.worldName, group);
    }

    const nextWorlds = [...nextByWorld.keys()].sort();

    const nextByDc = new Map<string, ChartSaleRecord[]>();
    for (const sale of chartSales) {
      const dc = worldIdToDc[sale.worldId] ?? "Unknown";
      const group = nextByDc.get(dc) ?? [];
      group.push(sale);
      nextByDc.set(dc, group);
    }

    const nextDcs = [...nextByDc.keys()].sort();

    const timestamps = chartSales.map((sale) => sale.soldAtMs);
    const minTime = Math.min(...timestamps);
    const maxTime = Math.max(...timestamps);
    const nextXDomain: [number, number] =
      Number.isFinite(minTime) && Number.isFinite(maxTime)
        ? minTime === maxTime
          ? [minTime - 12 * 60 * 60 * 1000, maxTime + 12 * 60 * 60 * 1000]
          : [minTime, maxTime]
        : [Date.now() - 24 * 60 * 60 * 1000, Date.now()];

    return {
      byWorld: nextByWorld,
      worlds: nextWorlds,
      dcs: nextDcs,
      byDc: nextByDc,
      xDomain: nextXDomain,
    };
  }, [chartSales, worldIdToDc]);

  const dcDailyAverages = useMemo(() => {
    const nextDcDailyAverages = new Map<string, ReturnType<typeof computeDailyAverages>>();
    for (const dc of dcs) {
      nextDcDailyAverages.set(dc, computeDailyAverages(byDc.get(dc)!));
    }
    return nextDcDailyAverages;
  }, [dcs, byDc]);

  const { worldColor, dcColor, dcBandColor } = useMemo(() => {
    const nextDcColor = new Map<string, string>();
    const nextDcBandColor = new Map<string, string>();
    dcs.forEach((dc, i) => {
      nextDcColor.set(dc, getDataCenterLineColor(i));
      nextDcBandColor.set(dc, getDataCenterBandColor(i));
    });

    const nextWorldColor = new Map<string, string>();
    dcs.forEach((dc, dcIndex) => {
      worlds
        .filter((world) => (worldToDc.get(world) ?? "Unknown") === dc)
        .forEach((world, worldIndex) => {
          nextWorldColor.set(world, getDataCenterWorldColor(dcIndex, worldIndex));
        });
    });

    return { worldColor: nextWorldColor, dcColor: nextDcColor, dcBandColor: nextDcBandColor };
  }, [dcs, worlds, worldToDc]);

  return (
    <div
      role="img"
      aria-label="Sale history chart showing data center daily average prices as lines with optional individual world sales as scatter points"
    >
      <ResponsiveContainer width="100%" height={450}>
        <ComposedChart margin={{ top: 16, right: 12, bottom: 24, left: 12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--chart-grid, #d3dce8)" opacity={0.65} />
          <XAxis
            dataKey="soldAtMs"
            domain={xDomain}
            tickFormatter={formatDateTick}
            type="number"
            scale="time"
            stroke="var(--chart-axis, #58677a)"
            tick={{ fontSize: 12, fill: "var(--chart-axis, #58677a)" }}
            tickCount={6}
            label={{
              value: "Date",
              position: "bottom",
              offset: 10,
              style: { fill: "var(--chart-axis, #58677a)", fontSize: 12 },
            }}
          />
          <YAxis
            dataKey="pricePerUnit"
            tickFormatter={(v: number) => v.toLocaleString()}
            stroke="var(--chart-axis, #58677a)"
            tick={{ fontSize: 12, fill: "var(--chart-axis, #58677a)" }}
            label={{
              value: "Gil",
              angle: -90,
              position: "insideLeft",
              style: { fill: "var(--chart-axis, #58677a)", fontSize: 12 },
            }}
          />
          <Tooltip
            contentStyle={{
              background: "var(--chart-tooltip-bg, #ffffff)",
              border: "1px solid var(--chart-tooltip-border, #c9d2df)",
              borderRadius: 6,
              fontSize: 13,
              color: "var(--chart-tooltip-text, #17202e)",
            }}
            labelStyle={{ color: "var(--chart-tooltip-text, #17202e)" }}
            formatter={(value, name) => {
              if (Array.isArray(value)) {
                return [`${safeString(value[0])} - ${safeString(value[1])} gil`, safeString(name)];
              }
              return [safeString(value) + " gil", safeString(name)];
            }}
            labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
          />
          <Legend
            iconSize={10}
            wrapperStyle={{
              color: "var(--chart-legend, #2f3f53)",
              fontSize: 12,
              maxHeight: 48,
              overflowY: "auto",
              paddingTop: 4,
            }}
          />
          {dcs.map((dc) =>
            visibleDcs.has(dc) ? (
              <Area
                key={`${dc}-quartiles`}
                name={`${dc} quartiles`}
                data={dcDailyAverages.get(dc)}
                dataKey="quartileRange"
                fill={dcBandColor.get(dc)}
                stroke="none"
                activeDot={false}
                dot={false}
                isAnimationActive={false}
                legendType="none"
              />
            ) : null,
          )}
          {dcs.map((dc) =>
            visibleDcs.has(dc) ? (
              <Line
                key={dc}
                name={`${dc} avg`}
                data={dcDailyAverages.get(dc)}
                dataKey="pricePerUnit"
                stroke={dcColor.get(dc)}
                strokeWidth={2}
                dot={false}
                connectNulls
                isAnimationActive={false}
              />
            ) : null,
          )}
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
                legendType="none"
                isAnimationActive={false}
              />
            ) : null,
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
