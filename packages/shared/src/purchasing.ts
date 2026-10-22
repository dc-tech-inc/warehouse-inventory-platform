import * as z from "zod";
import { PageQuery, safeText } from "./common.js";

export const Supplier = z.object({ id: z.uuid(), name: z.string(), country: z.string() }).meta({ id: "Supplier" });
export type Supplier = z.infer<typeof Supplier>;

export const CreateSupplierInput = z
  .object({ name: safeText(120), country: safeText(60) })
  .meta({ id: "CreateSupplierInput" });
export type CreateSupplierInput = z.infer<typeof CreateSupplierInput>;

export const PurchaseOrderStatus = z.enum(["draft", "submitted", "approved", "received", "cancelled"]);
export type PurchaseOrderStatus = z.infer<typeof PurchaseOrderStatus>;

export const PurchaseOrderAction = z.enum(["submit", "approve", "receive", "cancel"]);
export type PurchaseOrderAction = z.infer<typeof PurchaseOrderAction>;

const TRANSITIONS: Record<PurchaseOrderStatus, Partial<Record<PurchaseOrderAction, PurchaseOrderStatus>>> = {
  draft: { submit: "submitted", cancel: "cancelled" },
  submitted: { approve: "approved", cancel: "cancelled" },
  approved: { receive: "received", cancel: "cancelled" },
  received: {},
  cancelled: {},
};

/** The status after `action`, or null when the action is not allowed from `from`. */
export const nextStatus = (from: PurchaseOrderStatus, action: PurchaseOrderAction): PurchaseOrderStatus | null =>
  TRANSITIONS[from][action] ?? null;

export const PurchaseOrderLine = z
  .object({
    productId: z.uuid(),
    sku: z.string(),
    productName: z.string(),
    quantity: z.number().int(),
    unitCostCents: z.number().int(),
  })
  .meta({ id: "PurchaseOrderLine" });
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLine>;

export const PurchaseOrder = z
  .object({
    id: z.uuid(),
    number: z.string(),
    status: PurchaseOrderStatus,
    supplierId: z.uuid(),
    supplierName: z.string(),
    warehouseId: z.uuid(),
    warehouseCode: z.string(),
    createdBy: z.string().nullable(),
    approvedBy: z.string().nullable(),
    totalCents: z.number().int(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "PurchaseOrder" });
export type PurchaseOrder = z.infer<typeof PurchaseOrder>;

export const PurchaseOrderDetail = PurchaseOrder.extend({ lines: z.array(PurchaseOrderLine) }).meta({
  id: "PurchaseOrderDetail",
});
export type PurchaseOrderDetail = z.infer<typeof PurchaseOrderDetail>;

export const CreatePurchaseOrderInput = z
  .object({
    supplierId: z.uuid(),
    warehouseId: z.uuid(),
    lines: z
      .array(
        z.object({
          productId: z.uuid(),
          quantity: z.number().int().min(1).max(1_000_000),
          unitCostCents: z.number().int().min(0).max(100_000_000),
        }),
      )
      .min(1)
      .max(100)
      .refine((lines) => new Set(lines.map((l) => l.productId)).size === lines.length, {
        error: "Each product may appear once",
      }),
  })
  .meta({ id: "CreatePurchaseOrderInput" });
export type CreatePurchaseOrderInput = z.infer<typeof CreatePurchaseOrderInput>;

export const PurchaseOrderListQuery = PageQuery.extend({ status: PurchaseOrderStatus.optional() });
export const PurchaseOrderListResponse = z
  .object({ items: z.array(PurchaseOrder), total: z.number().int() })
  .meta({ id: "PurchaseOrderListResponse" });
export const PurchaseOrderResponse = z
  .object({ purchaseOrder: PurchaseOrderDetail })
  .meta({ id: "PurchaseOrderResponse" });
export const SupplierListResponse = z.object({ items: z.array(Supplier) }).meta({ id: "SupplierListResponse" });
export const SupplierResponse = z.object({ supplier: Supplier }).meta({ id: "SupplierResponse" });
