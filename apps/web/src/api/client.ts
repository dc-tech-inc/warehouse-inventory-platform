import type {
  AwardPointsInput,
  CreateMovementInput,
  CreateProductInput,
  CreatePurchaseOrderInput,
  CreateTransferInput,
  Credentials,
  Dashboard,
  Employee,
  EmployeeRewardsResponse,
  ErrorCode,
  ErrorResponse,
  Movement,
  Page,
  Product,
  ProductDetail,
  PublicUser,
  PurchaseOrder,
  PurchaseOrderAction,
  PurchaseOrderDetail,
  PurchaseOrderStatus,
  RewardItem,
  Supplier,
  Transfer,
  TransferStatus,
  Warehouse,
} from "@app/shared";

/** Thrown for every non-2xx response; mirrors the API's error envelope. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(path, {
    method: init.method ?? "GET",
    credentials: "include",
    headers: hasBody ? { "Content-Type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 204) return undefined as T;

  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const error = (data as Partial<ErrorResponse> | null)?.error;
    throw new ApiError(
      res.status,
      error?.code ?? "INTERNAL",
      error?.message ?? `Request failed with status ${res.status}`,
      error?.details,
    );
  }
  return data as T;
}

/** Builds `?a=1&b=2`, skipping undefined values. */
export function queryString(params: object): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  return entries.length === 0 ? "" : `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

const post = (body?: unknown) => ({ method: "POST", body });
const id = encodeURIComponent;

export interface Paging {
  limit?: number;
  offset?: number;
}

export const api = {
  login: (credentials: Credentials): Promise<PublicUser> =>
    request<{ user: PublicUser }>("/api/auth/login", post(credentials)).then((r) => r.user),
  logout: (): Promise<void> => request<void>("/api/auth/logout", post()),
  me: (): Promise<PublicUser> => request<{ user: PublicUser }>("/api/auth/me").then((r) => r.user),

  dashboard: (): Promise<Dashboard> => request("/api/dashboard"),
  warehouses: (): Promise<Warehouse[]> => request<{ items: Warehouse[] }>("/api/warehouses").then((r) => r.items),

  products: (q: Paging & { q?: string; lowStock?: boolean } = {}): Promise<Page<Product>> =>
    request(`/api/products${queryString(q)}`),
  product: (productId: string): Promise<ProductDetail> =>
    request<{ product: ProductDetail }>(`/api/products/${id(productId)}`).then((r) => r.product),
  createProduct: (input: CreateProductInput): Promise<ProductDetail> =>
    request<{ product: ProductDetail }>("/api/products", post(input)).then((r) => r.product),

  movements: (q: Paging & { productId?: string; warehouseId?: string } = {}): Promise<Page<Movement>> =>
    request(`/api/movements${queryString(q)}`),
  createMovement: (input: CreateMovementInput): Promise<Movement> =>
    request<{ movement: Movement }>("/api/movements", post(input)).then((r) => r.movement),

  transfers: (q: Paging & { status?: TransferStatus } = {}): Promise<Page<Transfer>> =>
    request(`/api/transfers${queryString(q)}`),
  createTransfer: (input: CreateTransferInput): Promise<Transfer> =>
    request<{ transfer: Transfer }>("/api/transfers", post(input)).then((r) => r.transfer),
  settleTransfer: (transferId: string, outcome: "receive" | "cancel"): Promise<Transfer> =>
    request<{ transfer: Transfer }>(`/api/transfers/${id(transferId)}/${outcome}`, post()).then((r) => r.transfer),

  suppliers: (): Promise<Supplier[]> => request<{ items: Supplier[] }>("/api/suppliers").then((r) => r.items),
  purchaseOrders: (q: Paging & { status?: PurchaseOrderStatus } = {}): Promise<Page<PurchaseOrder>> =>
    request(`/api/purchase-orders${queryString(q)}`),
  purchaseOrder: (poId: string): Promise<PurchaseOrderDetail> =>
    request<{ purchaseOrder: PurchaseOrderDetail }>(`/api/purchase-orders/${id(poId)}`).then((r) => r.purchaseOrder),
  createPurchaseOrder: (input: CreatePurchaseOrderInput): Promise<PurchaseOrderDetail> =>
    request<{ purchaseOrder: PurchaseOrderDetail }>("/api/purchase-orders", post(input)).then((r) => r.purchaseOrder),
  purchaseOrderAction: (poId: string, action: PurchaseOrderAction): Promise<PurchaseOrderDetail> =>
    request<{ purchaseOrder: PurchaseOrderDetail }>(`/api/purchase-orders/${id(poId)}/${action}`, post()).then(
      (r) => r.purchaseOrder,
    ),

  employees: (q: Paging & { department?: string } = {}): Promise<Page<Employee>> =>
    request(`/api/employees${queryString(q)}`),
  leaderboard: (): Promise<Employee[]> => request<{ items: Employee[] }>("/api/rewards/leaderboard").then((r) => r.items),
  rewardCatalog: (): Promise<RewardItem[]> => request<{ items: RewardItem[] }>("/api/rewards/catalog").then((r) => r.items),
  employeeRewards: (employeeId: string): Promise<EmployeeRewardsResponse> =>
    request(`/api/employees/${id(employeeId)}/rewards`),
  award: (employeeId: string, input: AwardPointsInput): Promise<EmployeeRewardsResponse> =>
    request(`/api/employees/${id(employeeId)}/rewards/award`, post(input)),
  redeem: (employeeId: string, rewardId: string): Promise<EmployeeRewardsResponse> =>
    request(`/api/employees/${id(employeeId)}/rewards/redeem`, post({ rewardId })),
};

export type Api = typeof api;
