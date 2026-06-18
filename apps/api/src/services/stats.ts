export function median(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

export function iqrAverage(prices: number[]): number | null {
  if (prices.length === 0) return null;
  if (prices.length <= 3) {
    return Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);
  }
  const sorted = [...prices].sort((a, b) => a - b);
  const n = sorted.length;
  const lowerHalf = sorted.slice(0, Math.floor(n / 2));
  const upperHalf = sorted.slice(Math.ceil(n / 2));
  const q1 = median(lowerHalf);
  const q3 = median(upperHalf);
  const iqr = q3 - q1;
  const lowerBound = q1 - 1.5 * iqr;
  const upperBound = q3 + 1.5 * iqr;
  const filtered = sorted.filter((p) => p >= lowerBound && p <= upperBound);
  if (filtered.length === 0) {
    return Math.round(sorted.reduce((a, b) => a + b, 0) / n);
  }
  return Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length);
}

export interface DcItemAverage {
  itemId: number;
  dataCenter: string;
  region: string;
  avgPrice: number;
  saleCount: number;
}
