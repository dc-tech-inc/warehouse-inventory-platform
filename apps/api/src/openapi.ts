import { OpenAPIRegistry, OpenApiGeneratorV31, type ResponseConfig } from "@asteasolutions/zod-to-openapi";
import {
  AwardPointsInput,
  CreateEmployeeInput,
  CreateMovementInput,
  CreateProductInput,
  CreatePurchaseOrderInput,
  CreateRewardItemInput,
  CreateSupplierInput,
  CreateTransferInput,
  CreateUserInput,
  CreateWarehouseInput,
  Credentials,
  Dashboard,
  EmployeeListQuery,
  EmployeeListResponse,
  EmployeeResponse,
  EmployeeRewardsResponse,
  ErrorResponse,
  IdParams,
  MovementListQuery,
  MovementListResponse,
  MovementResponse,
  ProductListQuery,
  ProductListResponse,
  ProductResponse,
  PurchaseOrderAction,
  PurchaseOrderListQuery,
  PurchaseOrderListResponse,
  PurchaseOrderResponse,
  RedeemInput,
  RewardCatalogResponse,
  RewardItemResponse,
  SupplierListResponse,
  SupplierResponse,
  TransferListQuery,
  TransferListResponse,
  TransferResponse,
  UpdateEmployeeInput,
  UpdateProductInput,
  UpdateUserInput,
  UserListResponse,
  UserResponse,
  WarehouseListResponse,
  WarehouseResponse,
} from "@app/shared";
import * as z from "zod";
import { ACTION_PERMISSION } from "./routes/purchasing.js";

export const HealthResponse = z
  .object({ status: z.enum(["ok", "unavailable"]), db: z.enum(["ok", "down"]) })
  .meta({ id: "HealthResponse" });

const json = (description: string, schema: z.ZodType): ResponseConfig => ({
  description,
  content: { "application/json": { schema } },
});
const error = (description: string) => json(description, ErrorResponse);

interface Op {
  method: "get" | "post" | "patch";
  path: string;
  summary: string;
  /** Needs a session. The permission is named in the description for readers of the document. */
  permission?: string;
  params?: z.ZodObject;
  query?: z.ZodObject;
  body?: z.ZodType;
  /** [status, description, schema]; schema omitted means no body. */
  ok: [number, string, z.ZodType?];
  /** Extra error statuses that can occur, besides the ones implied by the request shape. */
  errors?: Partial<Record<number, string>>;
}

/** Builds the OpenAPI 3.1 document from the same zod schemas the routes validate with. */
export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();
  registry.registerComponent("securitySchemes", "sessionCookie", { type: "apiKey", in: "cookie", name: "sid" });

  const add = (op: Op) => {
    const [status, okDescription, okSchema] = op.ok;
    const responses: Record<number, ResponseConfig> = {
      [status]: okSchema ? json(okDescription, okSchema) : { description: okDescription },
    };
    if (op.query || op.params || op.body) responses[400] = error("Request validation failed");
    if (op.permission) {
      responses[401] = error("Missing, invalid or expired session");
      if (op.permission !== "any") responses[403] = error(`Role lacks the ${op.permission} permission`);
    }
    for (const [code, description] of Object.entries(op.errors ?? {})) responses[Number(code)] = error(description ?? "");
    registry.registerPath({
      method: op.method,
      path: op.path,
      summary: op.summary,
      description: op.permission && op.permission !== "any" ? `Requires permission \`${op.permission}\`.` : undefined,
      security: op.permission ? [{ sessionCookie: [] }] : undefined,
      request: {
        params: op.params,
        query: op.query,
        body: op.body ? { required: true, content: { "application/json": { schema: op.body } } } : undefined,
      },
      responses,
    });
  };
  const idParams = IdParams;
  const notFound = (what: string) => ({ 404: `${what} does not exist` });

  add({ method: "get", path: "/health", summary: "Liveness and database connectivity", ok: [200, "Healthy", HealthResponse], errors: { 503: "Database unreachable" } });

  // Auth and users
  add({ method: "post", path: "/api/auth/login", summary: "Start a session", body: Credentials, ok: [200, "Logged in; sets the sid cookie", UserResponse], errors: { 401: "Invalid credentials (same message for unknown email and wrong password)", 429: "Too many login attempts" } });
  add({ method: "post", path: "/api/auth/logout", summary: "End the current session", permission: "any", ok: [204, "Session deleted, cookie cleared"] });
  add({ method: "get", path: "/api/auth/me", summary: "Current user and role", permission: "any", ok: [200, "Current user", UserResponse] });
  add({ method: "get", path: "/api/users", summary: "List accounts", permission: "users:manage", ok: [200, "Accounts", UserListResponse] });
  add({ method: "post", path: "/api/users", summary: "Create an account", permission: "users:manage", body: CreateUserInput, ok: [201, "Created", UserResponse], errors: { 409: "Email already registered" } });
  add({ method: "patch", path: "/api/users/{id}", summary: "Change name or role", permission: "users:manage", params: idParams, body: UpdateUserInput, ok: [200, "Updated", UserResponse], errors: { ...notFound("User"), 409: "Cannot change your own role" } });

  // Inventory
  add({ method: "get", path: "/api/dashboard", summary: "Headline counts", permission: "inventory:read", ok: [200, "Counts", Dashboard] });
  add({ method: "get", path: "/api/warehouses", summary: "List warehouses", permission: "inventory:read", ok: [200, "Warehouses", WarehouseListResponse] });
  add({ method: "post", path: "/api/warehouses", summary: "Create a warehouse", permission: "inventory:write", body: CreateWarehouseInput, ok: [201, "Created", WarehouseResponse], errors: { 409: "Code already exists" } });
  add({ method: "get", path: "/api/products", summary: "Search products with total stock (paginated)", permission: "inventory:read", query: ProductListQuery, ok: [200, "Page of products", ProductListResponse] });
  add({ method: "get", path: "/api/products/{id}", summary: "Product with per-warehouse stock", permission: "inventory:read", params: idParams, ok: [200, "Product", ProductResponse], errors: notFound("Product") });
  add({ method: "post", path: "/api/products", summary: "Create a product", permission: "inventory:write", body: CreateProductInput, ok: [201, "Created", ProductResponse], errors: { 409: "SKU already exists" } });
  add({ method: "patch", path: "/api/products/{id}", summary: "Update a product", permission: "inventory:write", params: idParams, body: UpdateProductInput, ok: [200, "Updated", ProductResponse], errors: notFound("Product") });

  // Movements and transfers
  add({ method: "get", path: "/api/movements", summary: "Stock movement history, newest first (paginated)", permission: "inventory:read", query: MovementListQuery, ok: [200, "Page of movements", MovementListResponse] });
  add({ method: "post", path: "/api/movements", summary: "Receive, issue or adjust stock", permission: "movements:create", body: CreateMovementInput, ok: [201, "Booked; stock updated in the same transaction", MovementResponse], errors: { ...notFound("Product or warehouse"), 403: "Adjustments need movements:adjust", 409: "Insufficient stock, or product inactive" } });
  add({ method: "get", path: "/api/transfers", summary: "List warehouse transfers", permission: "inventory:read", query: TransferListQuery, ok: [200, "Page of transfers", TransferListResponse] });
  add({ method: "post", path: "/api/transfers", summary: "Start a transfer (stock leaves the source now)", permission: "transfers:create", body: CreateTransferInput, ok: [201, "In transit", TransferResponse], errors: { ...notFound("Product or warehouse"), 409: "Insufficient stock at the source" } });
  for (const outcome of ["receive", "cancel"] as const) {
    add({ method: "post", path: `/api/transfers/{id}/${outcome}`, summary: outcome === "receive" ? "Land the transfer at the destination" : "Cancel and return stock to the source", permission: "transfers:create", params: idParams, ok: [200, "Settled", TransferResponse], errors: { ...notFound("Transfer"), 409: "Transfer is not in transit" } });
  }

  // Purchasing
  add({ method: "get", path: "/api/suppliers", summary: "List suppliers", permission: "purchasing:read", ok: [200, "Suppliers", SupplierListResponse] });
  add({ method: "post", path: "/api/suppliers", summary: "Create a supplier", permission: "purchasing:write", body: CreateSupplierInput, ok: [201, "Created", SupplierResponse], errors: { 409: "Supplier already exists" } });
  add({ method: "get", path: "/api/purchase-orders", summary: "List purchase orders (paginated)", permission: "purchasing:read", query: PurchaseOrderListQuery, ok: [200, "Page of purchase orders", PurchaseOrderListResponse] });
  add({ method: "get", path: "/api/purchase-orders/{id}", summary: "Purchase order with lines", permission: "purchasing:read", params: idParams, ok: [200, "Purchase order", PurchaseOrderResponse], errors: notFound("Purchase order") });
  add({ method: "post", path: "/api/purchase-orders", summary: "Create a draft purchase order", permission: "purchasing:write", body: CreatePurchaseOrderInput, ok: [201, "Draft created", PurchaseOrderResponse], errors: { ...notFound("Supplier, warehouse or product"), 409: "Product inactive" } });
  for (const action of PurchaseOrderAction.options) {
    const extra = action === "approve" ? { 403: "Role lacks purchasing:approve, or you created this order" } : {};
    add({ method: "post", path: `/api/purchase-orders/{id}/${action}`, summary: `Workflow step: ${action} (draft → submitted → approved → received; cancel until received)`, permission: ACTION_PERMISSION[action], params: idParams, ok: [200, "New status", PurchaseOrderResponse], errors: { ...notFound("Purchase order"), 409: `Cannot ${action} from the current status`, ...extra } });
  }

  // People and rewards (synthetic data)
  add({ method: "get", path: "/api/employees", summary: "List employees with reward balance (paginated)", permission: "employees:read", query: EmployeeListQuery, ok: [200, "Page of employees", EmployeeListResponse] });
  add({ method: "post", path: "/api/employees", summary: "Add an employee", permission: "employees:write", body: CreateEmployeeInput, ok: [201, "Created", EmployeeResponse] });
  add({ method: "get", path: "/api/employees/{id}", summary: "One employee", permission: "employees:read", params: idParams, ok: [200, "Employee", EmployeeResponse], errors: notFound("Employee") });
  add({ method: "patch", path: "/api/employees/{id}", summary: "Update department, title or active flag", permission: "employees:write", params: idParams, body: UpdateEmployeeInput, ok: [200, "Updated", EmployeeResponse], errors: notFound("Employee") });
  add({ method: "get", path: "/api/rewards/catalog", summary: "Redeemable rewards", permission: "rewards:read", ok: [200, "Catalog", RewardCatalogResponse] });
  add({ method: "post", path: "/api/rewards/catalog", summary: "Add a reward to the catalog", permission: "rewards:manage", body: CreateRewardItemInput, ok: [201, "Created", RewardItemResponse], errors: { 409: "Name already exists" } });
  add({ method: "get", path: "/api/rewards/leaderboard", summary: "Top 10 active employees by points", permission: "rewards:read", ok: [200, "Leaderboard", EmployeeListResponse.omit({ total: true })] });
  add({ method: "get", path: "/api/employees/{id}/rewards", summary: "Point balance and ledger", permission: "rewards:read", params: idParams, ok: [200, "Ledger", EmployeeRewardsResponse], errors: notFound("Employee") });
  add({ method: "post", path: "/api/employees/{id}/rewards/award", summary: "Award points", permission: "rewards:award", params: idParams, body: AwardPointsInput, ok: [201, "New ledger", EmployeeRewardsResponse], errors: { ...notFound("Employee"), 409: "Employee is inactive" } });
  add({ method: "post", path: "/api/employees/{id}/rewards/redeem", summary: "Spend points on a catalog reward", permission: "rewards:award", params: idParams, body: RedeemInput, ok: [201, "New ledger", EmployeeRewardsResponse], errors: { ...notFound("Employee or reward"), 409: "Not enough points, or reward unavailable" } });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: {
      title: "warehouse-inventory-platform API",
      version: "0.1.0",
      description:
        "Inventory, logistics, purchasing, employees and rewards. Session cookie auth with admin / manager / clerk roles. " +
        "All example data is synthetic. Errors always use the ErrorResponse envelope.",
      license: { name: "MIT" },
    },
  });
}
