import type { ArbitrageOpportunity } from "@xiv-arbitrage/shared";
import type { ItemDetails } from "../lib/xivapi.js";
import { useLocation } from "wouter";

interface EnrichedOpportunity extends ArbitrageOpportunity {
  item: ItemDetails;
}

interface OpportunityTableProps {
  opportunities: EnrichedOpportunity[];
  isLoading: boolean;
}

export function OpportunityTable({ opportunities, isLoading }: OpportunityTableProps) {
  const [, navigate] = useLocation();
  if (isLoading && opportunities.length === 0) {
    return (
      <div className="notice" role="status" aria-live="polite">
        Scanning market board data...
      </div>
    );
  }

  if (opportunities.length === 0) {
    return <div className="notice">No opportunities match the current filters.</div>;
  }

  return (
    <section className="tableShell" aria-busy={isLoading} aria-label="Opportunities table">
      <table>
        <thead>
          <tr>
            <th scope="col">Item</th>
            <th scope="col">Buy from</th>
            <th scope="col">Sell to</th>
            <th scope="col">Net spread</th>
            <th scope="col">Volume</th>
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
                    <img
                      src={opportunity.item.iconUrl}
                      alt=""
                      width="42"
                      height="42"
                      loading="lazy"
                    />
                  ) : null}
                  <div>
                    <button
                      type="button"
                      className="itemNameButton"
                      onClick={() => navigate(`/items/${opportunity.itemId}`)}
                      aria-label={`View sale history for ${opportunity.item.name}`}
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
