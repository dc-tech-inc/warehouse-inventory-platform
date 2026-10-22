import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const roleEnum = pgEnum("role", ["admin", "manager", "clerk"]);
export const movementKindEnum = pgEnum("movement_kind", ["receipt", "issue", "adjustment", "transfer_out", "transfer_in"]);
export const transferStatusEnum = pgEnum("transfer_status", ["in_transit", "received", "cancelled"]);
export const purchaseOrderStatusEnum = pgEnum("purchase_order_status", [
  "draft",
  "submitted",
  "approved",
  "received",
  "cancelled",
]);
export const ledgerKindEnum = pgEnum("ledger_kind", ["earn", "redeem"]);

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Stored lower-cased; the API normalizes before insert and lookup.
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  role: roleEnum("role").notNull().default("clerk"),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
});

export const sessions = pgTable("sessions", {
  // sha256 hex of the opaque token; the raw token only ever lives in the cookie.
  id: text("id").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

// --- Inventory ---

export const warehouses = pgTable("warehouses", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: varchar("code", { length: 12 }).notNull().unique(),
  name: text("name").notNull(),
  city: text("city").notNull(),
});

export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sku: varchar("sku", { length: 32 }).notNull().unique(),
    name: text("name").notNull(),
    unit: text("unit").notNull().default("each"),
    reorderPoint: integer("reorder_point").notNull().default(0),
    unitCostCents: integer("unit_cost_cents").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("products_reorder_point_nonneg", sql`${t.reorderPoint} >= 0`),
    check("products_unit_cost_nonneg", sql`${t.unitCostCents} >= 0`),
  ],
);

export const stockLevels = pgTable(
  "stock_levels",
  {
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    quantity: integer("quantity").notNull().default(0),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.warehouseId] }),
    // Backstop: the service refuses to go negative, the database refuses too.
    check("stock_levels_quantity_nonneg", sql`${t.quantity} >= 0`),
  ],
);

export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    fromWarehouseId: uuid("from_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    toWarehouseId: uuid("to_warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    quantity: integer("quantity").notNull(),
    status: transferStatusEnum("status").notNull().default("in_transit"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    receivedAt: timestamp("received_at", { withTimezone: true }),
  },
  (t) => [
    check("transfers_quantity_positive", sql`${t.quantity} > 0`),
    check("transfers_distinct_warehouses", sql`${t.fromWarehouseId} <> ${t.toWarehouseId}`),
    index("transfers_status_idx").on(t.status, t.createdAt),
  ],
);

export const purchaseOrders = pgTable(
  "purchase_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // Human-facing number is "PO-" + zero-padded seq, formatted in the API.
    seq: integer("seq").generatedAlwaysAsIdentity().notNull().unique(),
    status: purchaseOrderStatusEnum("status").notNull().default("draft"),
    supplierId: uuid("supplier_id")
      .notNull()
      .references(() => suppliers.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("purchase_orders_status_idx").on(t.status, t.createdAt)],
);

export const suppliers = pgTable("suppliers", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  country: text("country").notNull(),
});

export const purchaseOrderLines = pgTable(
  "purchase_order_lines",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    purchaseOrderId: uuid("purchase_order_id")
      .notNull()
      .references(() => purchaseOrders.id, { onDelete: "cascade" }),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    quantity: integer("quantity").notNull(),
    unitCostCents: integer("unit_cost_cents").notNull(),
  },
  (t) => [
    unique("po_lines_po_product_uniq").on(t.purchaseOrderId, t.productId),
    check("po_lines_quantity_positive", sql`${t.quantity} > 0`),
    check("po_lines_cost_nonneg", sql`${t.unitCostCents} >= 0`),
  ],
);

export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    warehouseId: uuid("warehouse_id")
      .notNull()
      .references(() => warehouses.id),
    kind: movementKindEnum("kind").notNull(),
    delta: integer("delta").notNull(),
    note: text("note"),
    transferId: uuid("transfer_id").references(() => transfers.id),
    purchaseOrderId: uuid("purchase_order_id").references(() => purchaseOrders.id),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("stock_movements_delta_nonzero", sql`${t.delta} <> 0`),
    index("stock_movements_product_idx").on(t.productId, t.createdAt),
    index("stock_movements_warehouse_idx").on(t.warehouseId, t.createdAt),
  ],
);

// --- People & rewards (all rows are synthetic) ---

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  department: text("department").notNull(),
  title: text("title").notNull(),
  hiredOn: date("hired_on", { mode: "string" }).notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const rewardCatalog = pgTable(
  "reward_catalog",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull().unique(),
    pointsCost: integer("points_cost").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (t) => [check("reward_catalog_cost_positive", sql`${t.pointsCost} > 0`)],
);

export const rewardLedger = pgTable(
  "reward_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    kind: ledgerKindEnum("kind").notNull(),
    // Positive for earn, negative for redeem. Balance = sum(points).
    points: integer("points").notNull(),
    reason: text("reason").notNull(),
    rewardId: uuid("reward_id").references(() => rewardCatalog.id),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("reward_ledger_points_nonzero", sql`${t.points} <> 0`),
    check("reward_ledger_sign_matches_kind", sql`(${t.kind} = 'earn' AND ${t.points} > 0) OR (${t.kind} = 'redeem' AND ${t.points} < 0)`),
    index("reward_ledger_employee_idx").on(t.employeeId, t.createdAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type SessionRow = typeof sessions.$inferSelect;
