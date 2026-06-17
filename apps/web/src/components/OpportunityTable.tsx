import type { ArbitrageOpportunity } from "@xiv-arbitrage/shared";

interface OpportunityTableProps {
  opportunities: ArbitrageOpportunity[];
  isLoading: boolean;
  onItemClick?: (itemId: number, itemName: string) => void;
}

export function OpportunityTable({ opportunities, isLoading, onItemClick }: OpportunityTableProps) {
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
            <th>Net spread</th>
            <th>Volume</th>
          </tr>
        </thead>
        <tbody>
          {opportunities.map((opportunity) => (
            <tr
              key={`${opportunity.itemId}-${opportunity.high.worldId}-${opportunity.low.worldId}`}
            >
              <td>
                <div className="itemCell">
                  {opportunity.item.iconUrl ? (
                    <img src={opportunity.item.iconUrl} alt="" loading="lazy" />
                  ) : null}
                  <div>
                    <button
                      type="button"
                      className="itemNameButton"
                      onClick={() => onItemClick?.(opportunity.itemId, opportunity.item.name)}
                      title="View sale history"
                    >
                      <strong>{opportunity.item.name}</strong>
                    </button>
                    <span>{opportunity.item.category ?? "Uncategorized"}</span>
                  </div>
                </div>
              </td>
              <td>
                <strong>{opportunity.netBuyPrice.toLocaleString()} gil</strong>
                <span>
                  {opportunity.low.worldName}, {opportunity.low.dataCenter}
                  &ensp;(list {opportunity.low.pricePerUnit.toLocaleString()})
                </span>
              </td>
              <td>
                <strong>{opportunity.netSellPrice.toLocaleString()} gil</strong>
                <span>
                  {opportunity.high.worldName}, {opportunity.high.dataCenter}
                  &ensp;(sale {opportunity.high.pricePerUnit.toLocaleString()})
                </span>
              </td>
              <td>
                <strong>{opportunity.spread.toLocaleString()} gil</strong>
                <span>
                  {opportunity.spreadPercent.toFixed(1)}% net &ensp;(
                  {opportunity.grossSpreadPercent.toFixed(1)}% gross)
                </span>
              </td>
              <td>
                <strong>{opportunity.recentSales.toLocaleString()}</strong>
                <span>recent units</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
