import * as z from "zod";
import { boolFlag, PageQuery, safeText } from "./common.js";

const isoDate = z.iso.datetime();
const cents = z.number().int().min(0).max(100_000_000);

export const Warehouse = z
  .object({ id: z.uuid(), code: z.string(), name: z.string(), city: z.string() })
  .meta({ id: "Warehouse" });
export type Warehouse = z.infer<typeof Warehouse>;

export const CreateWarehouseInput = z
  .object({
    code: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{2,12}$/, { error: "2-12 chars: A-Z, 0-9, dash" }),
    name: safeText(100),
    city: safeText(100),
  })
  .meta({ id: "CreateWarehouseInput" });
export type CreateWarehouseInput = z.input<typeof CreateWarehouseInput>;

export const WarehouseListResponse = z.object({ items: z.array(Warehouse) }).meta({ id: "WarehouseListResponse" });
export const WarehouseResponse = z.object({ warehouse: Warehouse }).meta({ id: "WarehouseResponse" });

export const Product = z
  .object({
    id: z.uuid(),
    sku: z.string(),
    name: z.string(),
    unit: z.string(),
    reorderPoint: z.number().int(),
    unitCostCents: z.number().int(),
    active: z.boolean(),
    /** Sum over all warehouses. */
    totalQuantity: z.number().int(),
    lowStock: z.boolean(),
  })
  .meta({ id: "Product" });
export type Product = z.infer<typeof Product>;

export const StockLevel = z
  .object({ warehouseId: z.uuid(), warehouseCode: z.string(), quantity: z.number().int() })
  .meta({ id: "StockLevel" });
export type StockLevel = z.infer<typeof StockLevel>;

export const ProductDetail = Product.extend({ stock: z.array(StockLevel) }).meta({ id: "ProductDetail" });
export type ProductDetail = z.infer<typeof ProductDetail>;

export const CreateProductInput = z
  .object({
    sku: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/, { error: "3-32 chars: A-Z, 0-9, dash" }),
    name: safeText(150),
    unit: safeText(20).default("each"),
    reorderPoint: z.number().int().min(0).max(1_000_000).default(0),
    unitCostCents: cents.default(0),
  })
  .meta({ id: "CreateProductInput" });
export type CreateProductInput = z.input<typeof CreateProductInput>;

export const UpdateProductInput = z
  .object({
    name: safeText(150).optional(),
    unit: safeText(20).optional(),
    reorderPoint: z.number().int().min(0).max(1_000_000).optional(),
    unitCostCents: cents.optional(),
    active: z.boolean().optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: "Provide at least one field" })
  .meta({ id: "UpdateProductInput" });
export type UpdateProductInput = z.infer<typeof UpdateProductInput>;

export const ProductListQuery = PageQuery.extend({
  q: z.string().trim().max(100).optional(),
  lowStock: boolFlag.optional(),
});
export type ProductListQuery = z.infer<typeof ProductListQuery>;

export const ProductListResponse = z
  .object({ items: z.array(Product), total: z.number().int() })
  .meta({ id: "ProductListResponse" });
export const ProductResponse = z.object({ product: ProductDetail }).meta({ id: "ProductResponse" });

// --- Movements ---

export const MovementKind = z.enum(["receipt", "issue", "adjustment", "transfer_out", "transfer_in"]);
export type MovementKind = z.infer<typeof MovementKind>;

export const Movement = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    sku: z.string(),
    warehouseId: z.uuid(),
    warehouseCode: z.string(),
    kind: MovementKind,
    /** Signed change applied to stock. */
    delta: z.number().int(),
    note: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: isoDate,
  })
  .meta({ id: "Movement" });
export type Movement = z.infer<typeof Movement>;

const qty = z.number().int().min(1).max(1_000_000);
const note = safeText(300).optional();

/** receipt/issue take a positive quantity; adjustment takes a signed, non-zero delta and a mandatory note. */
export const CreateMovementInput = z
  .discriminatedUnion("kind", [
    z.object({ kind: z.literal("receipt"), productId: z.uuid(), warehouseId: z.uuid(), quantity: qty, note }),
    z.object({ kind: z.literal("issue"), productId: z.uuid(), warehouseId: z.uuid(), quantity: qty, note }),
    z.object({
      kind: z.literal("adjustment"),
      productId: z.uuid(),
      warehouseId: z.uuid(),
      quantity: z
        .number()
        .int()
        .min(-1_000_000)
        .max(1_000_000)
        .refine((v) => v !== 0, { error: "Must not be zero" }),
      note: safeText(300),
    }),
  ])
  .meta({ id: "CreateMovementInput" });
export type CreateMovementInput = z.infer<typeof CreateMovementInput>;

export const MovementListQuery = PageQuery.extend({
  productId: z.uuid().optional(),
  warehouseId: z.uuid().optional(),
});
export type MovementListQuery = z.infer<typeof MovementListQuery>;

export const MovementListResponse = z
  .object({ items: z.array(Movement), total: z.number().int() })
  .meta({ id: "MovementListResponse" });
export const MovementResponse = z.object({ movement: Movement }).meta({ id: "MovementResponse" });

// --- Transfers ---

export const TransferStatus = z.enum(["in_transit", "received", "cancelled"]);
export type TransferStatus = z.infer<typeof TransferStatus>;

export const Transfer = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    sku: z.string(),
    fromWarehouseId: z.uuid(),
    fromCode: z.string(),
    toWarehouseId: z.uuid(),
    toCode: z.string(),
    quantity: z.number().int(),
    status: TransferStatus,
    createdAt: isoDate,
    receivedAt: isoDate.nullable(),
  })
  .meta({ id: "Transfer" });
export type Transfer = z.infer<typeof Transfer>;

export const CreateTransferInput = z
  .object({ productId: z.uuid(), fromWarehouseId: z.uuid(), toWarehouseId: z.uuid(), quantity: qty })
  .refine((v) => v.fromWarehouseId !== v.toWarehouseId, {
    error: "Source and destination must differ",
    path: ["toWarehouseId"],
  })
  .meta({ id: "CreateTransferInput" });
export type CreateTransferInput = z.infer<typeof CreateTransferInput>;

export const TransferListQuery = PageQuery.extend({ status: TransferStatus.optional() });
export const TransferListResponse = z
  .object({ items: z.array(Transfer), total: z.number().int() })
  .meta({ id: "TransferListResponse" });
export const TransferResponse = z.object({ transfer: Transfer }).meta({ id: "TransferResponse" });

export const Dashboard = z
  .object({
    products: z.number().int(),
    lowStock: z.number().int(),
    openPurchaseOrders: z.number().int(),
    transfersInTransit: z.number().int(),
    movementsLast7Days: z.number().int(),
  })
  .meta({ id: "Dashboard" });
export type Dashboard = z.infer<typeof Dashboard>;
