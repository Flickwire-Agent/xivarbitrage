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
  let result;
  if (filtered.length === 0) {
    result = Math.round(sorted.reduce((a, b) => a + b, 0) / n);
  } else {
    result = Math.round(filtered.reduce((a, b) => a + b, 0) / filtered.length);
  }

  // Guard against wash trades: when the IQR mean is >5x the median,
  // the IQR bounds were inflated by extreme outliers and the mean is
  // still skewed. Fall back to the median (robust to any outlier).
  const med = median(sorted);
  if (med > 0 && result / med > 5) {
    return Math.round(med);
  }

  return result;
}

export interface DcItemAverage {
  itemId: number;
  dataCenter: string;
  region: string;
  avgPrice: number;
  saleCount: number;
}
