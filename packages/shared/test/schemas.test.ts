import { describe, expect, it } from "vitest";
import {
  CreateMovementInput,
  CreateProductInput,
  CreatePurchaseOrderInput,
  CreateTransferInput,
  CreateUserInput,
  Credentials,
  ErrorResponse,
  PageQuery,
  ProductListQuery,
  safeText,
  UpdateProductInput,
} from "../src/index.js";

const ID_A = "6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01";
const ID_B = "0b9f3b0c-2f1e-4c3a-8c55-7a1d2e3f4a02";

describe("Credentials", () => {
  it("lower-cases the email", () => {
    const parsed = Credentials.parse({ email: "Ada@Example.COM", password: "correct horse battery" });
    expect(parsed.email).toBe("ada@example.com");
  });

  it("rejects passwords shorter than 12 or longer than 128 characters", () => {
    expect(Credentials.safeParse({ email: "a@example.com", password: "short" }).success).toBe(false);
    expect(Credentials.safeParse({ email: "a@example.com", password: "x".repeat(129) }).success).toBe(false);
  });

  it("rejects malformed emails", () => {
    expect(Credentials.safeParse({ email: "not-an-email", password: "x".repeat(12) }).success).toBe(false);
  });
});

describe("CreateUserInput", () => {
  it("requires a known role", () => {
    const base = { email: "u@example.com", name: "U", password: "x".repeat(12) };
    expect(CreateUserInput.safeParse({ ...base, role: "manager" }).success).toBe(true);
    expect(CreateUserInput.safeParse({ ...base, role: "root" }).success).toBe(false);
  });
});

describe("safeText", () => {
  it("trims, rejects blanks and over-long text", () => {
    expect(safeText(10).parse("  hi  ")).toBe("hi");
    expect(safeText(10).safeParse("   ").success).toBe(false);
    expect(safeText(3).safeParse("abcd").success).toBe(false);
  });

  it("rejects NUL characters, which PostgreSQL text cannot store", () => {
    expect(safeText(10).safeParse("a\u0000b").success).toBe(false);
    expect(safeText(10).safeParse("a0000b").success).toBe(true);
  });
});

describe("product inputs", () => {
  it("upper-cases and validates SKUs, applying defaults", () => {
    const parsed = CreateProductInput.parse({ sku: "bolt-m8", name: "Bolt M8" });
    expect(parsed).toMatchObject({ sku: "BOLT-M8", unit: "each", reorderPoint: 0, unitCostCents: 0 });
    expect(CreateProductInput.safeParse({ sku: "no spaces!", name: "x" }).success).toBe(false);
    expect(CreateProductInput.safeParse({ sku: "AB", name: "x" }).success).toBe(false);
  });

  it("rejects negative or fractional money and reorder points", () => {
    expect(CreateProductInput.safeParse({ sku: "ABC", name: "x", unitCostCents: -1 }).success).toBe(false);
    expect(CreateProductInput.safeParse({ sku: "ABC", name: "x", unitCostCents: 1.5 }).success).toBe(false);
    expect(CreateProductInput.safeParse({ sku: "ABC", name: "x", reorderPoint: -1 }).success).toBe(false);
  });

  it("requires at least one field on update", () => {
    expect(UpdateProductInput.safeParse({}).success).toBe(false);
    expect(UpdateProductInput.safeParse({ active: false }).success).toBe(true);
  });
});

describe("CreateMovementInput", () => {
  const base = { productId: ID_A, warehouseId: ID_B };

  it("takes a positive quantity for receipts and issues", () => {
    expect(CreateMovementInput.safeParse({ ...base, kind: "receipt", quantity: 5 }).success).toBe(true);
    expect(CreateMovementInput.safeParse({ ...base, kind: "issue", quantity: 0 }).success).toBe(false);
    expect(CreateMovementInput.safeParse({ ...base, kind: "issue", quantity: -3 }).success).toBe(false);
    expect(CreateMovementInput.safeParse({ ...base, kind: "receipt", quantity: 1.5 }).success).toBe(false);
  });

  it("takes a signed, non-zero quantity and a note for adjustments", () => {
    expect(CreateMovementInput.safeParse({ ...base, kind: "adjustment", quantity: -4, note: "cycle count" }).success).toBe(true);
    expect(CreateMovementInput.safeParse({ ...base, kind: "adjustment", quantity: 0, note: "x" }).success).toBe(false);
    expect(CreateMovementInput.safeParse({ ...base, kind: "adjustment", quantity: 4 }).success).toBe(false);
  });

  it("does not accept transfer kinds (transfers have their own endpoint)", () => {
    expect(CreateMovementInput.safeParse({ ...base, kind: "transfer_out", quantity: 1 }).success).toBe(false);
  });
});

describe("CreateTransferInput", () => {
  it("rejects the same source and destination", () => {
    const result = CreateTransferInput.safeParse({ productId: ID_A, fromWarehouseId: ID_B, toWarehouseId: ID_B, quantity: 1 });
    expect(result.success).toBe(false);
    expect(CreateTransferInput.safeParse({ productId: ID_A, fromWarehouseId: ID_A, toWarehouseId: ID_B, quantity: 1 }).success).toBe(true);
  });
});

describe("CreatePurchaseOrderInput", () => {
  const line = (productId: string) => ({ productId, quantity: 2, unitCostCents: 150 });

  it("needs at least one line and rejects a product listed twice", () => {
    const base = { supplierId: ID_A, warehouseId: ID_B };
    expect(CreatePurchaseOrderInput.safeParse({ ...base, lines: [] }).success).toBe(false);
    expect(CreatePurchaseOrderInput.safeParse({ ...base, lines: [line(ID_A), line(ID_A)] }).success).toBe(false);
    expect(CreatePurchaseOrderInput.safeParse({ ...base, lines: [line(ID_A), line(ID_B)] }).success).toBe(true);
  });
});

describe("query parsing", () => {
  it("applies pagination defaults and bounds", () => {
    expect(PageQuery.parse({})).toEqual({ limit: 25, offset: 0 });
    expect(PageQuery.parse({ limit: "50", offset: "10" })).toEqual({ limit: 50, offset: 10 });
    expect(PageQuery.safeParse({ limit: "101" }).success).toBe(false);
    expect(PageQuery.safeParse({ limit: "0" }).success).toBe(false);
    expect(PageQuery.safeParse({ offset: "-1" }).success).toBe(false);
  });

  it("parses the lowStock flag from a query string", () => {
    expect(ProductListQuery.parse({ lowStock: "true" }).lowStock).toBe(true);
    expect(ProductListQuery.parse({ lowStock: "false" }).lowStock).toBe(false);
    expect(ProductListQuery.parse({}).lowStock).toBeUndefined();
    expect(ProductListQuery.safeParse({ lowStock: "yes" }).success).toBe(false);
  });
});

describe("ErrorResponse", () => {
  it("only accepts known error codes", () => {
    expect(ErrorResponse.safeParse({ error: { code: "NOT_FOUND", message: "x" } }).success).toBe(true);
    expect(ErrorResponse.safeParse({ error: { code: "FORBIDDEN", message: "x" } }).success).toBe(true);
    expect(ErrorResponse.safeParse({ error: { code: "TEAPOT", message: "x" } }).success).toBe(false);
  });
});
