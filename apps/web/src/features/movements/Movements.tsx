import { can, type CreateMovementInput, type Product, type Role, type Warehouse } from "@app/shared";
import { useState, type FormEvent } from "react";
import { api } from "../../api/client";
import { formatDateTime, formatNumber } from "../../format";
import { useAction, useLoad } from "../../hooks";
import { Data, FormError, Pager, Sku, Status } from "../../ui";

const PAGE = 12;

export function Movements({ role }: { role: Role }) {
  const refs = useLoad("movement-refs", async () => {
    const [products, warehouses] = await Promise.all([api.products({ limit: 100 }), api.warehouses()]);
    return { products: products.items, warehouses };
  });
  const [offset, setOffset] = useState(0);
  const history = useLoad(`movements|${offset}`, () => api.movements({ limit: PAGE, offset }));
  const transfers = useLoad("transfers", () => api.transfers({ limit: 20 }));

  const refresh = () => {
    history.reload();
    transfers.reload();
  };

  return (
    <div className="stack">
      <Data state={refs.state} empty="">
        {({ products, warehouses }) => (
          <div className="two-col">
            <BookStock role={role} products={products} warehouses={warehouses} onBooked={() => { setOffset(0); refresh(); }} />
            <NewTransfer products={products} warehouses={warehouses} onCreated={refresh} />
          </div>
        )}
      </Data>

      <section aria-labelledby="h-transfers">
        <h2 id="h-transfers">Transfers</h2>
        <Data state={transfers.state} empty="No transfers yet." isEmpty={(p) => p.items.length === 0}>
          {(page) => (
            <table>
              <thead>
                <tr><th>SKU</th><th>Route</th><th className="r">Qty</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr>
              </thead>
              <tbody>
                {page.items.map((t) => (
                  <tr key={t.id}>
                    <td><Sku>{t.sku}</Sku></td>
                    <td>{t.fromCode} → {t.toCode}</td>
                    <td className="r num">{formatNumber(t.quantity)}</td>
                    <td><Status value={t.status} /></td>
                    <td className="r actions">
                      {t.status === "in_transit" && (
                        <TransferActions id={t.id} onDone={refresh} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Data>
      </section>

      <section aria-labelledby="h-history">
        <h2 id="h-history">History</h2>
        <Data state={history.state} empty="No stock has moved yet." isEmpty={(p) => p.items.length === 0}>
          {(page) => (
            <>
              <table>
                <thead>
                  <tr><th>When</th><th>SKU</th><th>Warehouse</th><th>Kind</th><th className="r">Change</th><th>Note</th><th>By</th></tr>
                </thead>
                <tbody>
                  {page.items.map((m) => (
                    <tr key={m.id}>
                      <td className="muted">{formatDateTime(m.createdAt)}</td>
                      <td><Sku>{m.sku}</Sku></td>
                      <td>{m.warehouseCode}</td>
                      <td><Status value={m.kind} /></td>
                      <td className={`r num ${m.delta < 0 ? "neg" : "pos"}`}>{m.delta > 0 ? `+${m.delta}` : m.delta}</td>
                      <td>{m.note ?? ""}</td>
                      <td className="muted">{m.createdBy ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pager offset={offset} limit={PAGE} total={page.total} onChange={setOffset} />
            </>
          )}
        </Data>
      </section>
    </div>
  );
}

function TransferActions({ id, onDone }: { id: string; onDone: () => void }) {
  const { busy, error, run } = useAction();
  const settle = async (outcome: "receive" | "cancel") => {
    if (await run(() => api.settleTransfer(id, outcome))) onDone();
  };
  return (
    <>
      <button type="button" className="ghost" disabled={busy} onClick={() => void settle("receive")}>Receive</button>
      <button type="button" className="ghost" disabled={busy} onClick={() => void settle("cancel")}>Cancel</button>
      <FormError message={error} />
    </>
  );
}

function BookStock({
  role,
  products,
  warehouses,
  onBooked,
}: {
  role: Role;
  products: Product[];
  warehouses: Warehouse[];
  onBooked: () => void;
}) {
  const [kind, setKind] = useState<CreateMovementInput["kind"]>("receipt");
  const [productId, setProductId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [note, setNote] = useState("");
  const [done, setDone] = useState<string | null>(null);
  const { busy, error, run } = useAction();
  const canAdjust = can(role, "movements:adjust");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(null);
    const input = { kind, productId, warehouseId, quantity: Number(quantity), note: note || undefined } as CreateMovementInput;
    const ok = await run(async () => {
      const m = await api.createMovement(input);
      setDone(`Booked ${m.delta > 0 ? "+" : ""}${m.delta} of ${m.sku} at ${m.warehouseCode}.`);
    });
    if (ok) {
      setNote("");
      onBooked();
    }
  }

  return (
    <form className="panel form-grid" onSubmit={submit} aria-labelledby="h-book">
      <h2 id="h-book">Book stock</h2>
      <label>
        Kind
        <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)}>
          <option value="receipt">Receipt (stock in)</option>
          <option value="issue">Issue (stock out)</option>
          {canAdjust && <option value="adjustment">Adjustment (±, needs a note)</option>}
        </select>
      </label>
      <label>
        Product
        <select required value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Choose…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
        </select>
      </label>
      <label>
        Warehouse
        <select required value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
          <option value="">Choose…</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.city}</option>)}
        </select>
      </label>
      <label>
        Quantity{kind === "adjustment" ? " (negative removes)" : ""}
        <input type="number" step={1} required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <label>
        Note{kind === "adjustment" ? "" : " (optional)"}
        <input value={note} required={kind === "adjustment"} maxLength={300} onChange={(e) => setNote(e.target.value)} />
      </label>
      <FormError message={error} />
      {done && <p className="ok" role="status">{done}</p>}
      <button type="submit" className="primary" disabled={busy}>{busy ? "Booking…" : "Book it"}</button>
    </form>
  );
}

function NewTransfer({
  products,
  warehouses,
  onCreated,
}: {
  products: Product[];
  warehouses: Warehouse[];
  onCreated: () => void;
}) {
  const [productId, setProductId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [quantity, setQuantity] = useState("1");
  const { busy, error, run } = useAction();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (await run(() => api.createTransfer({ productId, fromWarehouseId: from, toWarehouseId: to, quantity: Number(quantity) }))) {
      onCreated();
    }
  }

  return (
    <form className="panel form-grid" onSubmit={submit} aria-labelledby="h-transfer">
      <h2 id="h-transfer">Start a transfer</h2>
      <label>
        Product
        <select required value={productId} onChange={(e) => setProductId(e.target.value)}>
          <option value="">Choose…</option>
          {products.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}</option>)}
        </select>
      </label>
      <label>
        From
        <select required value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">Choose…</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
        </select>
      </label>
      <label>
        To
        <select required value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="">Choose…</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.code}</option>)}
        </select>
      </label>
      <label>
        Quantity
        <input type="number" min={1} step={1} required value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      </label>
      <FormError message={error} />
      <p className="muted small">Stock leaves the source now and lands at the destination when someone receives it.</p>
      <button type="submit" className="primary" disabled={busy}>{busy ? "Starting…" : "Start transfer"}</button>
    </form>
  );
}
