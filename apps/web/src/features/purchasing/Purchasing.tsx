import {
  can,
  nextStatus,
  type Permission,
  type Product,
  type PublicUser,
  type PurchaseOrder,
  type PurchaseOrderAction,
  type Supplier,
  type Warehouse,
} from "@app/shared";
import { Fragment, useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { formatCents, formatDate, formatNumber } from "../../format";
import { useAction, useLoad } from "../../hooks";
import { Data, FormError, Pager, Sku, Status } from "../../ui";

const PAGE = 10;

// Mirrors ACTION_PERMISSION on the API; the server is the authority, this only decides which buttons to show.
const ACTION_PERMISSION: Record<PurchaseOrderAction, Permission> = {
  submit: "purchasing:write",
  approve: "purchasing:approve",
  receive: "purchasing:receive",
  cancel: "purchasing:approve",
};
const ACTION_LABEL: Record<PurchaseOrderAction, string> = {
  submit: "Submit",
  approve: "Approve",
  receive: "Receive stock",
  cancel: "Cancel",
};

export function Purchasing({ user }: { user: PublicUser }) {
  const [offset, setOffset] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useLoad(`pos|${offset}`, () => api.purchaseOrders({ limit: PAGE, offset }));

  return (
    <div className="stack">
      <section aria-labelledby="h-pos">
        <h2 id="h-pos">Purchase orders</h2>
        <Data state={list.state} empty="No purchase orders yet." isEmpty={(p) => p.items.length === 0}>
          {(page) => (
            <>
              <table>
                <thead>
                  <tr><th>Number</th><th>Supplier</th><th>Deliver to</th><th className="r">Total</th><th>Status</th><th>Created</th><th><span className="sr-only">Actions</span></th></tr>
                </thead>
                <tbody>
                  {page.items.map((po) => (
                    <Fragment key={po.id}>
                      <tr>
                        <td>
                          <button type="button" className="link" aria-expanded={openId === po.id} onClick={() => setOpenId(openId === po.id ? null : po.id)}>
                            {po.number}
                          </button>
                        </td>
                        <td>{po.supplierName}</td>
                        <td>{po.warehouseCode}</td>
                        <td className="r num">{formatCents(po.totalCents)}</td>
                        <td><Status value={po.status} /></td>
                        <td className="muted">{formatDate(po.createdAt)}{po.createdBy ? ` · ${po.createdBy}` : ""}</td>
                        <td className="r actions"><PoActions po={po} user={user} onDone={list.reload} /></td>
                      </tr>
                      {openId === po.id && (
                        <tr className="detail"><td colSpan={7}><PoLines id={po.id} /></td></tr>
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

      {can(user.role, "purchasing:write") && <NewOrder onCreated={() => { setOffset(0); list.reload(); }} />}
    </div>
  );
}

function PoLines({ id }: { id: string }) {
  const detail = useLoad(`po|${id}`, () => api.purchaseOrder(id));
  return (
    <Data state={detail.state} empty="">
      {(d) => (
        <table className="nested">
          <thead><tr><th>SKU</th><th>Item</th><th className="r">Qty</th><th className="r">Unit cost</th></tr></thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.productId}>
                <td><Sku>{l.sku}</Sku></td><td>{l.productName}</td>
                <td className="r num">{formatNumber(l.quantity)}</td><td className="r num">{formatCents(l.unitCostCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Data>
  );
}

function PoActions({ po, user, onDone }: { po: PurchaseOrder; user: PublicUser; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const actions = (["submit", "approve", "receive", "cancel"] as const).filter(
    (a) => nextStatus(po.status, a) !== null && can(user.role, ACTION_PERMISSION[a]),
  );
  if (actions.length === 0) return null;
  return (
    <>
      {actions.map((a) => (
        <button
          key={a}
          type="button"
          className={a === "cancel" ? "ghost" : "primary small"}
          disabled={busy}
          onClick={() => void run(() => api.purchaseOrderAction(po.id, a)).then((ok) => ok && onDone())}
        >
          {ACTION_LABEL[a]}
        </button>
      ))}
      <FormError message={error} />
    </>
  );
}

interface Line { productId: string; quantity: string; cost: string }

function NewOrder({ onCreated }: { onCreated: () => void }) {
  const refs = useLoad("po-refs", async () => {
    const [suppliers, warehouses, products] = await Promise.all([api.suppliers(), api.warehouses(), api.products({ limit: 100 })]);
    return { suppliers, warehouses, products: products.items };
  });
  return (
    <details className="panel">
      <summary>New purchase order</summary>
      <Data state={refs.state} empty="">
        {(r) => <OrderForm {...r} onCreated={onCreated} />}
      </Data>
    </details>
  );
}

function OrderForm({
  suppliers,
  warehouses,
  products,
  onCreated,
}: {
  suppliers: Supplier[];
  warehouses: Warehouse[];
  products: Product[];
  onCreated: () => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "10", cost: "1.00" }]);
  const { busy, error, run } = useAction();

  const setLine = (i: number, patch: Partial<Line>) => setLines(lines.map((l, j) => (i === j ? { ...l, ...patch } : l)));

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(() =>
      api.createPurchaseOrder({
        supplierId,
        warehouseId,
        lines: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCostCents: Math.round(Number(l.cost) * 100) })),
      }),
    );
    if (ok) {
      setLines([{ productId: "", quantity: "10", cost: "1.00" }]);
      onCreated();
    }
  }

  return (
    <form className="form-grid" onSubmit={submit}>
      <label>
        Supplier
        <select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Choose…</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </label>
      <label>
        Deliver to
        <select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">Choose…</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.city}</option>)}
        </select>
      </label>
      {lines.map((line, i) => (
        <fieldset key={i} className="line">
          <legend>Line {i + 1}</legend>
          <label>
            Product
            <select required value={line.productId} onChange={(e) => setLine(i, { productId: e.target.value })}>
              <option value="">Choose…</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
            </select>
          </label>
          <label>Qty<input type="number" min={1} step={1} required value={line.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></label>
          <label>Unit cost (USD)<input type="number" min={0} step="0.01" required value={line.cost} onChange={(e) => setLine(i, { cost: e.target.value })} /></label>
          {lines.length > 1 && (
            <button type="button" className="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove line</button>
          )}
        </fieldset>
      ))}
      <button type="button" className="ghost" onClick={() => setLines([...lines, { productId: "", quantity: "10", cost: "1.00" }])}>
        Add line
      </button>
      <FormError message={error} />
      <button type="submit" className="primary" disabled={busy}>{busy ? "Saving…" : "Create draft"}</button>
    </form>
  );
}
