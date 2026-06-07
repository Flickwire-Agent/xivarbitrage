import type { ArbitrageOpportunity } from "@xiv-arbitrage/shared";

function getUniversalisUrl(itemId: number): string {
  return `https://universalis.app/market/${itemId}`;
}

interface OpportunityTableProps {
  opportunities: ArbitrageOpportunity[];
  isLoading: boolean;
}

export function OpportunityTable({ opportunities, isLoading }: OpportunityTableProps) {
  if (isLoading && opportunities.length === 0) {
    return <div className="notice">Scanning market board data...</div>;
  }

  if (opportunities.length === 0) {
    return <div className="notice">No opportunities match the current filters.</div>;
  }

  return (
    <section className="tableShell" aria-busy={isLoading}>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Buy from</th>
            <th>Sell to</th>
            <th>Spread</th>
            <th>Volume</th>
            <th>Score</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => (
            <tr key={`${opportunity.itemId}-${opportunity.high.worldId}-${opportunity.low.worldId}`}>
              <td>
                <div className="itemCell">
                  {opportunity.item.iconUrl ? <img src={opportunity.item.iconUrl} alt="" loading="lazy" /> : null}
                  <div>
                    <a
                      href={getUniversalisUrl(opportunity.itemId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      title="View on Universalis"
                    >
                      <strong>{opportunity.item.name}</strong>
                    </a>
                    <span>{opportunity.item.category ?? "Uncategorized"}</span>
                  </div>
                </div>
              </td>
              <td>
                <strong>{opportunity.low.pricePerUnit.toLocaleString()} gil</strong>
                <span>
                  {opportunity.low.worldName}, {opportunity.low.dataCenter}
                </span>
              </td>
              <td>
                <strong>{opportunity.high.pricePerUnit.toLocaleString()} gil</strong>
                <span>
                  {opportunity.high.worldName}, {opportunity.high.dataCenter}
                </span>
              </td>
              <td>
                <strong>{opportunity.spread.toLocaleString()} gil</strong>
                <span>{opportunity.spreadPercent.toFixed(1)}%</span>
              </td>
              <td>
                <strong>{opportunity.recentSales.toLocaleString()}</strong>
                <span>recent units</span>
              </td>
              <td>
                <strong>{Math.round(opportunity.profitScore).toLocaleString()}</strong>
                <span>profit score</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
