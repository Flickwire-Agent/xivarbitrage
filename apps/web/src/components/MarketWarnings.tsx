import type { MarketWarning } from "@xiv-arbitrage/shared";

type MarketWarningsProps = {
  warnings?: MarketWarning[];
  compact?: boolean;
};

const SEVERITY_LABELS: Record<MarketWarning["severity"], string> = {
  info: "Info",
  warning: "Caution",
  critical: "High risk",
};

export function MarketWarnings({ warnings, compact = false }: MarketWarningsProps) {
  if (!warnings || warnings.length === 0) return null;

  return (
    <div className={`marketWarnings${compact ? " compact" : ""}`} aria-label="Market warnings">
      {warnings.map((warning) => (
        <span
          className={`marketWarning marketWarning-${warning.severity}`}
          title={warning.message}
          key={`${warning.code}-${warning.message}`}
        >
          <strong>{SEVERITY_LABELS[warning.severity]}</strong>
          <span>{compact ? warning.message : warning.message}</span>
        </span>
      ))}
    </div>
  );
}
