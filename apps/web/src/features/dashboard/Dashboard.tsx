import { api } from "../../api/client";
import { formatDateTime, formatNumber } from "../../format";
import { useLoad } from "../../hooks";
import { Data, Sku } from "../../ui";

export function Dashboard() {
  const summary = useLoad("dashboard", () => api.dashboard());
  const low = useLoad("dashboard-low", () => api.products({ lowStock: true, limit: 8 }));
  const recent = useLoad("dashboard-recent", () => api.movements({ limit: 8 }));

  return (
    <div className="stack">
      <section aria-labelledby="h-overview">
        <h2 id="h-overview">Headline counts</h2>
        <Data state={summary.state} empty="">
          {(d) => (
            <dl className="tally">
              <div><dt>Active products</dt><dd className="num">{formatNumber(d.products)}</dd></div>
              <div className={d.lowStock > 0 ? "alert" : undefined}><dt>At or below reorder point</dt><dd className="num">{formatNumber(d.lowStock)}</dd></div>
              <div><dt>Open purchase orders</dt><dd className="num">{formatNumber(d.openPurchaseOrders)}</dd></div>
              <div><dt>Transfers in transit</dt><dd className="num">{formatNumber(d.transfersInTransit)}</dd></div>
              <div><dt>Movements, last 7 days</dt><dd className="num">{formatNumber(d.movementsLast7Days)}</dd></div>
            </dl>
          )}
        </Data>
      </section>

      <div className="two-col">
        <section aria-labelledby="h-low">
          <h2 id="h-low">Reorder soon</h2>
          <Data state={low.state} empty="Nothing is at or below its reorder point." isEmpty={(p) => p.items.length === 0}>
            {(page) => (
              <table>
                <thead>
                  <tr><th>SKU</th><th>Name</th><th className="r">On hand</th><th className="r">Reorder at</th></tr>
                </thead>
                <tbody>
                  {page.items.map((p) => (
                    <tr key={p.id} className="low">
                      <td><Sku>{p.sku}</Sku></td>
                      <td>{p.name}</td>
                      <td className="r num">{formatNumber(p.totalQuantity)}</td>
                      <td className="r num">{formatNumber(p.reorderPoint)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Data>
        </section>

        <section aria-labelledby="h-recent">
          <h2 id="h-recent">Latest movements</h2>
          <Data state={recent.state} empty="No stock has moved yet." isEmpty={(p) => p.items.length === 0}>
            {(page) => (
              <table>
                <thead>
                  <tr><th>When</th><th>SKU</th><th>Where</th><th className="r">Change</th></tr>
                </thead>
                <tbody>
                  {page.items.map((m) => (
                    <tr key={m.id}>
                      <td className="muted">{formatDateTime(m.createdAt)}</td>
                      <td><Sku>{m.sku}</Sku></td>
                      <td>{m.warehouseCode}</td>
                      <td className={`r num ${m.delta < 0 ? "neg" : "pos"}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Data>
        </section>
      </div>
    </div>
  );
}
