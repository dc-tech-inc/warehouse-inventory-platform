import { can, type Product, type Role } from "@app/shared";
import { Fragment, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { formatCents, formatNumber } from "../../format";
import { useAction, useLoad } from "../../hooks";
import { Data, FormError, Pager, Sku } from "../../ui";

const PAGE = 15;

export function Inventory({ role }: { role: Role }) {
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useLoad(`products|${q}|${lowOnly}|${offset}`, () =>
    api.products({ q: q || undefined, lowStock: lowOnly ? true : undefined, limit: PAGE, offset }),
  );

  return (
    <div className="stack">
      <section aria-labelledby="h-products">
        <div className="section-head">
          <h2 id="h-products">Products</h2>
          <div className="filters">
            <label className="inline">
              <span className="sr-only">Search by SKU or name</span>
              <input
                type="search"
                placeholder="Search SKU or name"
                value={q}
                onChange={(e) => {
                  setQ(e.target.value);
                  setOffset(0);
                }}
              />
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={lowOnly}
                onChange={(e) => {
                  setLowOnly(e.target.checked);
                  setOffset(0);
                }}
              />
              Low stock only
            </label>
          </div>
        </div>

        <Data state={list.state} empty="No products match." isEmpty={(p) => p.items.length === 0}>
          {(page) => (
            <>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Name</th>
                    <th className="r">On hand</th>
                    <th className="r">Reorder at</th>
                    <th className="r">Unit cost</th>
                    <th>Status</th>
                    <th><span className="sr-only">Details</span></th>
                  </tr>
                </thead>
                <tbody>
                  {page.items.map((p) => (
                    <Fragment key={p.id}>
                      <tr className={p.lowStock ? "low" : undefined}>
                        <td><Sku>{p.sku}</Sku></td>
                        <td>{p.name}{!p.active && <span className="muted"> (inactive)</span>}</td>
                        <td className="r num">{formatNumber(p.totalQuantity)} <span className="muted unit">{p.unit}</span></td>
                        <td className="r num">{formatNumber(p.reorderPoint)}</td>
                        <td className="r num">{formatCents(p.unitCostCents)}</td>
                        <td>{p.lowStock ? <span className="status status-low">Low</span> : <span className="status status-ok">OK</span>}</td>
                        <td className="r">
                          <button
                            type="button"
                            className="ghost"
                            aria-expanded={openId === p.id}
                            onClick={() => setOpenId(openId === p.id ? null : p.id)}
                          >
                            {openId === p.id ? "Hide" : "By warehouse"}
                          </button>
                        </td>
                      </tr>
                      {openId === p.id && (
                        <tr className="detail">
                          <td colSpan={7}><StockByWarehouse product={p} /></td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
              <Pager offset={offset} limit={PAGE} total={page.total} onChange={setOffset} />
            </>
          )}
        </Data>
      </section>

      {can(role, "inventory:write") && <NewProduct onCreated={list.reload} />}
    </div>
  );
}

function StockByWarehouse({ product }: { product: Product }) {
  const detail = useLoad(`product|${product.id}`, () => api.product(product.id));
  return (
    <Data state={detail.state} empty="" >
      {(d) =>
        d.stock.length === 0 ? (
          <p className="muted">No stock on hand in any warehouse.</p>
        ) : (
          <ul className="chips">
            {d.stock.map((s) => (
              <li key={s.warehouseId}><strong>{s.warehouseCode}</strong> <span className="num">{formatNumber(s.quantity)}</span></li>
            ))}
          </ul>
        )
      }
    </Data>
  );
}

function NewProduct({ onCreated }: { onCreated: () => void }) {
  const [sku, setSku] = useState("");
  const [name, setName] = useState("");
  const [reorderPoint, setReorderPoint] = useState("0");
  const [cost, setCost] = useState("0.00");
  const { busy, error, run } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(() =>
      api.createProduct({ sku, name, reorderPoint: Number(reorderPoint), unitCostCents: Math.round(Number(cost) * 100) }),
    );
    if (ok) {
      setSku("");
      setName("");
      setReorderPoint("0");
      setCost("0.00");
      onCreated();
    }
  }

  return (
    <details className="panel">
      <summary>Add a product</summary>
      <form className="form-grid" onSubmit={submit}>
        <label>SKU<input required value={sku} onChange={(e) => setSku(e.target.value)} placeholder="BOLT-M10" /></label>
        <label>Name<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label>Reorder point<input type="number" min={0} step={1} required value={reorderPoint} onChange={(e) => setReorderPoint(e.target.value)} /></label>
        <label>Unit cost (USD)<input type="number" min={0} step="0.01" required value={cost} onChange={(e) => setCost(e.target.value)} /></label>
        <FormError message={error} />
        <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Add product"}</button>
      </form>
    </details>
  );
}
