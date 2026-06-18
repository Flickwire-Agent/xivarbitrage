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
  const { byWorld, worlds, worldColor, dcs, dcDailyAverages, dcColor, dcBandColor, xDomain } =
    useMemo(() => {
      const chartSales = sales
        .map((sale) => ({ ...sale, soldAtMs: new Date(sale.soldAt).getTime() }))
        .filter((sale) => Number.isFinite(sale.soldAtMs));

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
      const nextDcDailyAverages = new Map<string, ReturnType<typeof computeDailyAverages>>();
      for (const dc of nextDcs) {
        nextDcDailyAverages.set(dc, computeDailyAverages(nextByDc.get(dc)!));
      }

      const nextDcColor = new Map<string, string>();
      const nextDcBandColor = new Map<string, string>();
      nextDcs.forEach((dc, i) => {
        nextDcColor.set(dc, getDataCenterLineColor(i));
        nextDcBandColor.set(dc, getDataCenterBandColor(i));
      });

      const nextWorldColor = new Map<string, string>();
      nextDcs.forEach((dc, dcIndex) => {
        nextWorlds
          .filter((world) => (worldToDc.get(world) ?? "Unknown") === dc)
          .forEach((world, worldIndex) => {
            nextWorldColor.set(world, getDataCenterWorldColor(dcIndex, worldIndex));
          });
      });

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
        worldColor: nextWorldColor,
        dcs: nextDcs,
        dcDailyAverages: nextDcDailyAverages,
        dcColor: nextDcColor,
        dcBandColor: nextDcBandColor,
        xDomain: nextXDomain,
      };
    }, [sales, worldIdToDc, worldToDc]);

  return (
    <div
      role="img"
      aria-label="Sale history chart showing individual world sales as scatter points and data center daily average prices as lines"
    >
      <ResponsiveContainer width="100%" height={450}>
        <ComposedChart margin={{ top: 20, right: 20, bottom: 30, left: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#2a3a4f" opacity={0.3} />
          <XAxis
            dataKey="soldAtMs"
            domain={xDomain}
            tickFormatter={formatDateTick}
            type="number"
            scale="time"
            stroke="#687586"
            tick={{ fontSize: 12 }}
            tickCount={6}
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
            formatter={(value, name) => {
              if (Array.isArray(value)) {
                return [`${safeString(value[0])} - ${safeString(value[1])} gil`, safeString(name)];
              }
              return [safeString(value) + " gil", safeString(name)];
            }}
            labelFormatter={(label) => new Date(Number(label)).toLocaleString()}
          />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
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
              />
            ) : null,
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
