import {
  products,
  purchaseOrderLines,
  purchaseOrders,
  suppliers,
  users,
  warehouses,
  type Database,
} from "@app/db";
import {
  nextStatus,
  type CreatePurchaseOrderInput,
  type CreateSupplierInput,
  type Page,
  type PurchaseOrder,
  type PurchaseOrderAction,
  type PurchaseOrderDetail,
  type PurchaseOrderStatus,
  type Supplier,
} from "@app/shared";
import { count, desc, eq, inArray, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { conflict, forbidden, notFound } from "../middleware/error-handler.js";
import { applyStockDelta, insertMovement } from "./inventory-service.js";

export const formatPoNumber = (seq: number) => `PO-${String(seq).padStart(6, "0")}`;

export type PurchasingService = ReturnType<typeof createPurchasingService>;

export function createPurchasingService(db: Database) {
  const creator = alias(users, "creator");
  const approver = alias(users, "approver");
  const total = sql<number>`coalesce((select sum(${purchaseOrderLines.quantity} * ${purchaseOrderLines.unitCostCents}) from ${purchaseOrderLines} where ${purchaseOrderLines.purchaseOrderId} = ${purchaseOrders.id}), 0)::int`;

  const headerSelect = () =>
    db
      .select({
        id: purchaseOrders.id,
        seq: purchaseOrders.seq,
        status: purchaseOrders.status,
        supplierId: purchaseOrders.supplierId,
        supplierName: suppliers.name,
        warehouseId: purchaseOrders.warehouseId,
        warehouseCode: warehouses.code,
        createdBy: creator.name,
        approvedBy: approver.name,
        totalCents: total.mapWith(Number),
        createdAt: purchaseOrders.createdAt,
      })
      .from(purchaseOrders)
      .innerJoin(suppliers, eq(suppliers.id, purchaseOrders.supplierId))
      .innerJoin(warehouses, eq(warehouses.id, purchaseOrders.warehouseId))
      .leftJoin(creator, eq(creator.id, purchaseOrders.createdBy))
      .leftJoin(approver, eq(approver.id, purchaseOrders.approvedBy));
  type HeaderRow = Awaited<ReturnType<ReturnType<typeof headerSelect>["limit"]>>[number];
  const toHeader = ({ seq, createdAt, ...rest }: HeaderRow): PurchaseOrder => ({
    ...rest,
    number: formatPoNumber(seq),
    createdAt: createdAt.toISOString(),
  });

  async function getDetail(id: string): Promise<PurchaseOrderDetail> {
    const [header] = await headerSelect().where(eq(purchaseOrders.id, id));
    if (!header) throw notFound("Purchase order not found");
    const lines = await db
      .select({
        productId: purchaseOrderLines.productId,
        sku: products.sku,
        productName: products.name,
        quantity: purchaseOrderLines.quantity,
        unitCostCents: purchaseOrderLines.unitCostCents,
      })
      .from(purchaseOrderLines)
      .innerJoin(products, eq(products.id, purchaseOrderLines.productId))
      .where(eq(purchaseOrderLines.purchaseOrderId, id))
      .orderBy(products.sku);
    return { ...toHeader(header), lines };
  }

  return {
    async listSuppliers(): Promise<Supplier[]> {
      return db.select().from(suppliers).orderBy(suppliers.name);
    },

    async createSupplier(input: CreateSupplierInput): Promise<Supplier> {
      const [row] = await db.insert(suppliers).values(input).onConflictDoNothing({ target: suppliers.name }).returning();
      if (!row) throw conflict("Supplier already exists");
      return row;
    },

    async list({ status, limit, offset }: { status?: PurchaseOrderStatus; limit: number; offset: number }): Promise<Page<PurchaseOrder>> {
      const where = status ? eq(purchaseOrders.status, status) : undefined;
      const [rows, [counted]] = await Promise.all([
        headerSelect().where(where).orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.seq)).limit(limit).offset(offset),
        db.select({ n: count() }).from(purchaseOrders).where(where),
      ]);
      return { items: rows.map(toHeader), total: counted?.n ?? 0 };
    },

    get: getDetail,

    async create(input: CreatePurchaseOrderInput, userId: string): Promise<PurchaseOrderDetail> {
      const id = await db.transaction(async (tx) => {
        const [supplier] = await tx.select({ id: suppliers.id }).from(suppliers).where(eq(suppliers.id, input.supplierId));
        if (!supplier) throw notFound("Supplier not found");
        const [warehouse] = await tx.select({ id: warehouses.id }).from(warehouses).where(eq(warehouses.id, input.warehouseId));
        if (!warehouse) throw notFound("Warehouse not found");
        const found = await tx
          .select({ id: products.id, active: products.active })
          .from(products)
          .where(inArray(products.id, input.lines.map((l) => l.productId)));
        if (found.length !== input.lines.length) throw notFound("Product not found");
        if (found.some((p) => !p.active)) throw conflict("Product is inactive");

        const [po] = await tx
          .insert(purchaseOrders)
          .values({ supplierId: input.supplierId, warehouseId: input.warehouseId, createdBy: userId })
          .returning({ id: purchaseOrders.id });
        if (!po) throw new Error("insert returned no row");
        await tx.insert(purchaseOrderLines).values(input.lines.map((l) => ({ ...l, purchaseOrderId: po.id })));
        return po.id;
      });
      return getDetail(id);
    },

    /**
     * Runs one workflow action. Allowed transitions live in `nextStatus` (shared, unit-tested);
     * approving your own order is refused (separation of duties); receiving books one receipt movement per line.
     */
    async act(id: string, action: PurchaseOrderAction, userId: string): Promise<PurchaseOrderDetail> {
      await db.transaction(async (tx) => {
        const [po] = await tx.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).for("update");
        if (!po) throw notFound("Purchase order not found");
        const to = nextStatus(po.status, action);
        if (!to) throw conflict(`Cannot ${action} a ${po.status} purchase order`);
        if (action === "approve" && po.createdBy === userId) {
          throw forbidden("You cannot approve a purchase order you created");
        }
        if (action === "receive") {
          const lines = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.purchaseOrderId, id));
          for (const line of lines) {
            await applyStockDelta(tx, line.productId, po.warehouseId, line.quantity);
            await insertMovement(tx, {
              productId: line.productId,
              warehouseId: po.warehouseId,
              kind: "receipt",
              delta: line.quantity,
              note: `Received ${formatPoNumber(po.seq)}`,
              purchaseOrderId: po.id,
              createdBy: userId,
            });
          }
        }
        await tx
          .update(purchaseOrders)
          .set({ status: to, updatedAt: sql`now()`, ...(action === "approve" ? { approvedBy: userId } : {}) })
          .where(eq(purchaseOrders.id, id));
      });
      return getDetail(id);
    },
  };
}
