import {
  products,
  purchaseOrders,
  stockLevels,
  stockMovements,
  transfers,
  users,
  warehouses,
  type Database,
} from "@app/db";
import type {
  CreateMovementInput,
  CreateProductInput,
  CreateTransferInput,
  CreateWarehouseInput,
  Dashboard,
  Movement,
  MovementKind,
  MovementListQuery,
  Page,
  Product,
  ProductDetail,
  ProductListQuery,
  Transfer,
  TransferStatus,
  UpdateProductInput,
  Warehouse,
} from "@app/shared";
import { and, count, desc, eq, gt, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { alias, QueryBuilder } from "drizzle-orm/pg-core";
import { conflict, notFound } from "../middleware/error-handler.js";

/** A pool-backed database or the transaction handle inside `db.transaction`. */
export type Executor = Pick<Database, "select" | "insert" | "update" | "delete" | "execute">;

const isUniqueViolation = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (("cause" in err && isUniqueViolation(err.cause)) || ("code" in err && err.code === "23505"));

export const lowStockFlag = (totalQuantity: number, reorderPoint: number) =>
  reorderPoint > 0 && totalQuantity <= reorderPoint;

/**
 * Applies a signed change to one (product, warehouse) stock row.
 * A negative change that would drop the quantity below zero is refused with 409 and changes nothing.
 */
export async function applyStockDelta(
  tx: Executor,
  productId: string,
  warehouseId: string,
  delta: number,
): Promise<number> {
  if (delta > 0) {
    const [row] = await tx
      .insert(stockLevels)
      .values({ productId, warehouseId, quantity: delta })
      .onConflictDoUpdate({
        target: [stockLevels.productId, stockLevels.warehouseId],
        set: { quantity: sql`${stockLevels.quantity} + ${delta}` },
      })
      .returning({ quantity: stockLevels.quantity });
    return row?.quantity ?? delta;
  }
  const [row] = await tx
    .update(stockLevels)
    .set({ quantity: sql`${stockLevels.quantity} + ${delta}` })
    .where(
      and(
        eq(stockLevels.productId, productId),
        eq(stockLevels.warehouseId, warehouseId),
        sql`${stockLevels.quantity} + ${delta} >= 0`,
      ),
    )
    .returning({ quantity: stockLevels.quantity });
  if (!row) {
    const [current] = await tx
      .select({ quantity: stockLevels.quantity })
      .from(stockLevels)
      .where(and(eq(stockLevels.productId, productId), eq(stockLevels.warehouseId, warehouseId)));
    throw conflict("Insufficient stock", { available: current?.quantity ?? 0, requested: -delta });
  }
  return row.quantity;
}

export async function insertMovement(
  tx: Executor,
  row: {
    productId: string;
    warehouseId: string;
    kind: MovementKind;
    delta: number;
    note?: string | null;
    transferId?: string;
    purchaseOrderId?: string;
    createdBy: string;
  },
): Promise<string> {
  const [inserted] = await tx.insert(stockMovements).values(row).returning({ id: stockMovements.id });
  if (!inserted) throw new Error("insert returned no row");
  return inserted.id;
}

async function requireProduct(tx: Executor, id: string, opts: { active?: boolean } = {}) {
  const [row] = await tx.select().from(products).where(eq(products.id, id));
  if (!row) throw notFound("Product not found");
  if (opts.active && !row.active) throw conflict("Product is inactive");
  return row;
}

async function requireWarehouse(tx: Executor, id: string) {
  const [row] = await tx.select().from(warehouses).where(eq(warehouses.id, id));
  if (!row) throw notFound("Warehouse not found");
  return row;
}

export type InventoryService = ReturnType<typeof createInventoryService>;

export function createInventoryService(db: Database) {
  // QueryBuilder needs no connection, so the service can be constructed with a stub database in unit tests.
  const totals = new QueryBuilder()
    .select({ productId: stockLevels.productId, qty: sql<number>`sum(${stockLevels.quantity})::int`.as("qty") })
    .from(stockLevels)
    .groupBy(stockLevels.productId)
    .as("totals");
  const totalQty = sql<number>`coalesce(${totals.qty}, 0)`;

  const productColumns = {
    id: products.id,
    sku: products.sku,
    name: products.name,
    unit: products.unit,
    reorderPoint: products.reorderPoint,
    unitCostCents: products.unitCostCents,
    active: products.active,
    totalQuantity: totalQty.mapWith(Number),
  };
  const toProduct = (r: Omit<Product, "lowStock">): Product => ({
    ...r,
    lowStock: lowStockFlag(r.totalQuantity, r.reorderPoint),
  });

  const movementSelect = (executor: Executor) =>
    executor
      .select({
        id: stockMovements.id,
        productId: stockMovements.productId,
        sku: products.sku,
        warehouseId: stockMovements.warehouseId,
        warehouseCode: warehouses.code,
        kind: stockMovements.kind,
        delta: stockMovements.delta,
        note: stockMovements.note,
        createdBy: users.name,
        createdAt: stockMovements.createdAt,
      })
      .from(stockMovements)
      .innerJoin(products, eq(products.id, stockMovements.productId))
      .innerJoin(warehouses, eq(warehouses.id, stockMovements.warehouseId))
      .leftJoin(users, eq(users.id, stockMovements.createdBy));
  const toMovement = (r: Awaited<ReturnType<ReturnType<typeof movementSelect>["limit"]>>[number]): Movement => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
  });

  const fromWh = alias(warehouses, "from_wh");
  const toWh = alias(warehouses, "to_wh");
  const transferSelect = (executor: Executor) =>
    executor
      .select({
        id: transfers.id,
        productId: transfers.productId,
        sku: products.sku,
        fromWarehouseId: transfers.fromWarehouseId,
        fromCode: fromWh.code,
        toWarehouseId: transfers.toWarehouseId,
        toCode: toWh.code,
        quantity: transfers.quantity,
        status: transfers.status,
        createdAt: transfers.createdAt,
        receivedAt: transfers.receivedAt,
      })
      .from(transfers)
      .innerJoin(products, eq(products.id, transfers.productId))
      .innerJoin(fromWh, eq(fromWh.id, transfers.fromWarehouseId))
      .innerJoin(toWh, eq(toWh.id, transfers.toWarehouseId));
  const toTransfer = (r: Awaited<ReturnType<ReturnType<typeof transferSelect>["limit"]>>[number]): Transfer => ({
    ...r,
    createdAt: r.createdAt.toISOString(),
    receivedAt: r.receivedAt?.toISOString() ?? null,
  });

  async function getTransfer(executor: Executor, id: string): Promise<Transfer> {
    const [row] = await transferSelect(executor).where(eq(transfers.id, id));
    if (!row) throw notFound("Transfer not found");
    return toTransfer(row);
  }

  return {
    // --- Warehouses ---

    async listWarehouses(): Promise<Warehouse[]> {
      return db.select().from(warehouses).orderBy(warehouses.code);
    },

    async createWarehouse(input: CreateWarehouseInput & { code: string }): Promise<Warehouse> {
      try {
        const [row] = await db.insert(warehouses).values(input).returning();
        if (!row) throw new Error("insert returned no row");
        return row;
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict("Warehouse code already exists");
        throw err;
      }
    },

    // --- Products ---

    async listProducts({ q, lowStock, limit, offset }: ProductListQuery): Promise<Page<Product>> {
      const conditions: (SQL | undefined)[] = [
        q ? or(ilike(products.sku, `%${escapeLike(q)}%`), ilike(products.name, `%${escapeLike(q)}%`)) : undefined,
        lowStock === true ? and(gt(products.reorderPoint, 0), sql`${totalQty} <= ${products.reorderPoint}`) : undefined,
        lowStock === false ? sql`not (${products.reorderPoint} > 0 and ${totalQty} <= ${products.reorderPoint})` : undefined,
      ];
      const where = and(...conditions);
      const [rows, [counted]] = await Promise.all([
        db
          .select(productColumns)
          .from(products)
          .leftJoin(totals, eq(totals.productId, products.id))
          .where(where)
          .orderBy(products.sku)
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(products).leftJoin(totals, eq(totals.productId, products.id)).where(where),
      ]);
      return { items: rows.map(toProduct), total: counted?.n ?? 0 };
    },

    async getProduct(id: string): Promise<ProductDetail> {
      const [row] = await db
        .select(productColumns)
        .from(products)
        .leftJoin(totals, eq(totals.productId, products.id))
        .where(eq(products.id, id));
      if (!row) throw notFound("Product not found");
      const stock = await db
        .select({ warehouseId: stockLevels.warehouseId, warehouseCode: warehouses.code, quantity: stockLevels.quantity })
        .from(stockLevels)
        .innerJoin(warehouses, eq(warehouses.id, stockLevels.warehouseId))
        .where(eq(stockLevels.productId, id))
        .orderBy(warehouses.code);
      return { ...toProduct(row), stock };
    },

    async createProduct(input: CreateProductInput & { sku: string; name: string }, ): Promise<ProductDetail> {
      let id: string;
      try {
        const [row] = await db.insert(products).values(input).returning({ id: products.id });
        if (!row) throw new Error("insert returned no row");
        id = row.id;
      } catch (err) {
        if (isUniqueViolation(err)) throw conflict("SKU already exists");
        throw err;
      }
      return this.getProduct(id);
    },

    async updateProduct(id: string, patch: UpdateProductInput): Promise<ProductDetail> {
      const [row] = await db.update(products).set(patch).where(eq(products.id, id)).returning({ id: products.id });
      if (!row) throw notFound("Product not found");
      return this.getProduct(id);
    },

    // --- Movements ---

    async createMovement(input: CreateMovementInput, userId: string): Promise<Movement> {
      const delta = input.kind === "issue" ? -input.quantity : input.quantity;
      const id = await db.transaction(async (tx) => {
        await requireProduct(tx, input.productId, { active: input.kind !== "adjustment" });
        await requireWarehouse(tx, input.warehouseId);
        await applyStockDelta(tx, input.productId, input.warehouseId, delta);
        return insertMovement(tx, {
          productId: input.productId,
          warehouseId: input.warehouseId,
          kind: input.kind,
          delta,
          note: input.note,
          createdBy: userId,
        });
      });
      const [row] = await movementSelect(db).where(eq(stockMovements.id, id));
      if (!row) throw new Error("movement vanished");
      return toMovement(row);
    },

    async listMovements({ productId, warehouseId, limit, offset }: MovementListQuery): Promise<Page<Movement>> {
      const where = and(
        productId ? eq(stockMovements.productId, productId) : undefined,
        warehouseId ? eq(stockMovements.warehouseId, warehouseId) : undefined,
      );
      const [rows, [counted]] = await Promise.all([
        movementSelect(db)
          .where(where)
          .orderBy(desc(stockMovements.createdAt), desc(stockMovements.id))
          .limit(limit)
          .offset(offset),
        db.select({ n: count() }).from(stockMovements).where(where),
      ]);
      return { items: rows.map(toMovement), total: counted?.n ?? 0 };
    },

    // --- Transfers ---

    async createTransfer(input: CreateTransferInput, userId: string): Promise<Transfer> {
      const id = await db.transaction(async (tx) => {
        await requireProduct(tx, input.productId, { active: true });
        await requireWarehouse(tx, input.fromWarehouseId);
        await requireWarehouse(tx, input.toWarehouseId);
        await applyStockDelta(tx, input.productId, input.fromWarehouseId, -input.quantity);
        const [transfer] = await tx
          .insert(transfers)
          .values({ ...input, createdBy: userId })
          .returning({ id: transfers.id });
        if (!transfer) throw new Error("insert returned no row");
        await insertMovement(tx, {
          productId: input.productId,
          warehouseId: input.fromWarehouseId,
          kind: "transfer_out",
          delta: -input.quantity,
          transferId: transfer.id,
          createdBy: userId,
        });
        return transfer.id;
      });
      return getTransfer(db, id);
    },

    async listTransfers({ status, limit, offset }: { status?: TransferStatus; limit: number; offset: number }): Promise<Page<Transfer>> {
      const where = status ? eq(transfers.status, status) : undefined;
      const [rows, [counted]] = await Promise.all([
        transferSelect(db).where(where).orderBy(desc(transfers.createdAt), desc(transfers.id)).limit(limit).offset(offset),
        db.select({ n: count() }).from(transfers).where(where),
      ]);
      return { items: rows.map(toTransfer), total: counted?.n ?? 0 };
    },

    /** Moves an in-transit transfer to `received` (stock lands at the destination) or `cancelled` (stock returns to the source). */
    async settleTransfer(id: string, outcome: "receive" | "cancel", userId: string): Promise<Transfer> {
      await db.transaction(async (tx) => {
        const [row] = await tx.select().from(transfers).where(eq(transfers.id, id)).for("update");
        if (!row) throw notFound("Transfer not found");
        if (row.status !== "in_transit") throw conflict(`Transfer is already ${row.status}`);
        const warehouseId = outcome === "receive" ? row.toWarehouseId : row.fromWarehouseId;
        await applyStockDelta(tx, row.productId, warehouseId, row.quantity);
        await insertMovement(tx, {
          productId: row.productId,
          warehouseId,
          kind: "transfer_in",
          delta: row.quantity,
          note: outcome === "cancel" ? "Transfer cancelled, returned to source" : undefined,
          transferId: row.id,
          createdBy: userId,
        });
        await tx
          .update(transfers)
          .set(
            outcome === "receive"
              ? { status: "received", receivedAt: sql`now()` }
              : { status: "cancelled" },
          )
          .where(eq(transfers.id, id));
      });
      return getTransfer(db, id);
    },

    // --- Dashboard ---

    async dashboard(): Promise<Dashboard> {
      const [productCount, lowStockCount, openPos, inTransit, recent] = await Promise.all([
        db.select({ n: count() }).from(products).where(eq(products.active, true)),
        db
          .select({ n: count() })
          .from(products)
          .leftJoin(totals, eq(totals.productId, products.id))
          .where(and(eq(products.active, true), gt(products.reorderPoint, 0), sql`${totalQty} <= ${products.reorderPoint}`)),
        db.select({ n: count() }).from(purchaseOrders).where(inArray(purchaseOrders.status, ["draft", "submitted", "approved"])),
        db.select({ n: count() }).from(transfers).where(eq(transfers.status, "in_transit")),
        db.select({ n: count() }).from(stockMovements).where(sql`${stockMovements.createdAt} > now() - interval '7 days'`),
      ]);
      return {
        products: productCount[0]?.n ?? 0,
        lowStock: lowStockCount[0]?.n ?? 0,
        openPurchaseOrders: openPos[0]?.n ?? 0,
        transfersInTransit: inTransit[0]?.n ?? 0,
        movementsLast7Days: recent[0]?.n ?? 0,
      };
    },
  };
}

/** Escapes LIKE wildcards so a search for "50%" matches the literal text. */
export const escapeLike = (value: string) => value.replace(/[\\%_]/g, "\\$&");
