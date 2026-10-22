import type { Page, Product, PublicUser, PurchaseOrder } from "@app/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../src/api/client";
import { App } from "../src/App";
import { Inventory } from "../src/features/inventory/Inventory";
import { Purchasing } from "../src/features/purchasing/Purchasing";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = "";
});

const product = (over: Partial<Product>): Product => ({
  id: crypto.randomUUID(),
  sku: "BOLT-M8",
  name: "Hex bolt M8",
  unit: "box",
  reorderPoint: 20,
  unitCostCents: 1850,
  active: true,
  totalQuantity: 4,
  lowStock: true,
  ...over,
});
function page<T>(items: T[]): Page<T> {
  return { items, total: items.length };
}

const user = (role: PublicUser["role"]): PublicUser => ({
  id: "u1",
  email: `${role}@example.test`,
  name: `Test ${role}`,
  role,
});

const po = (status: PurchaseOrder["status"]): PurchaseOrder => ({
  id: "po1",
  number: "PO-000001",
  status,
  supplierId: "s1",
  supplierName: "Acme (synthetic)",
  warehouseId: "w1",
  warehouseCode: "EAST",
  createdBy: "Test clerk",
  approvedBy: null,
  totalCents: 12345,
  createdAt: "2026-03-01T10:00:00.000Z",
});

describe("Inventory", () => {
  it("shows stock with a low-stock marker and formats money", async () => {
    vi.spyOn(api, "products").mockResolvedValue(
      page([product({}), product({ sku: "NUT-M8", name: "Hex nut", totalQuantity: 90, lowStock: false, unitCostCents: 900 })]),
    );
    render(<Inventory role="clerk" />);

    const rows = await screen.findAllByRole("row");
    expect(within(rows[1]!).getByText("BOLT-M8")).toBeTruthy();
    expect(within(rows[1]!).getByText("Low")).toBeTruthy();
    expect(within(rows[1]!).getByText("$18.50")).toBeTruthy();
    expect(within(rows[2]!).getByText("OK")).toBeTruthy();
    expect(rows[1]!.className).toBe("low");
  });

  it("passes search and low-stock filters to the API and resets paging", async () => {
    const spy = vi.spyOn(api, "products").mockResolvedValue(page([]));
    render(<Inventory role="clerk" />);
    await screen.findByText("No products match.");

    fireEvent.change(screen.getByPlaceholderText("Search SKU or name"), { target: { value: "nut" } });
    fireEvent.click(screen.getByLabelText("Low stock only"));
    await waitFor(() => expect(spy).toHaveBeenLastCalledWith({ q: "nut", lowStock: true, limit: 15, offset: 0 }));
  });

  it("only offers 'Add a product' to roles that can write inventory", async () => {
    vi.spyOn(api, "products").mockResolvedValue(page([]));
    const { unmount } = render(<Inventory role="clerk" />);
    await screen.findByText("No products match.");
    expect(screen.queryByText("Add a product")).toBeNull();
    unmount();
    render(<Inventory role="manager" />);
    await screen.findByText("Add a product");
  });

  it("shows the API error instead of an empty table", async () => {
    vi.spyOn(api, "products").mockRejectedValue(new ApiError(500, "INTERNAL", "Internal server error"));
    render(<Inventory role="clerk" />);
    expect((await screen.findByRole("alert")).textContent).toBe("Internal server error");
  });

  it("loads per-warehouse stock when a row is expanded", async () => {
    const p = product({});
    vi.spyOn(api, "products").mockResolvedValue(page([p]));
    vi.spyOn(api, "product").mockResolvedValue({ ...p, stock: [{ warehouseId: "w1", warehouseCode: "EAST", quantity: 4 }] });
    render(<Inventory role="clerk" />);
    fireEvent.click(await screen.findByRole("button", { name: "By warehouse" }));
    expect(await screen.findByText("EAST")).toBeTruthy();
  });
});

describe("Purchasing actions follow role and status", () => {
  const buttonsFor = async (role: PublicUser["role"], status: PurchaseOrder["status"]) => {
    vi.spyOn(api, "purchaseOrders").mockResolvedValue(page([po(status)]));
    render(<Purchasing user={user(role)} />);
    await screen.findByText("PO-000001");
    const row = screen.getByText("PO-000001").closest("tr")!;
    return within(row)
      .queryAllByRole("button")
      .map((b) => b.textContent)
      .filter((t) => t !== "PO-000001");
  };

  it("lets a clerk submit a draft but not approve", async () => {
    expect(await buttonsFor("clerk", "draft")).toEqual(["Submit"]);
  });

  it("lets a manager approve or cancel a submitted order", async () => {
    expect(await buttonsFor("manager", "submitted")).toEqual(["Approve", "Cancel"]);
  });

  it("lets a clerk receive an approved order", async () => {
    expect(await buttonsFor("clerk", "approved")).toEqual(["Receive stock"]);
  });

  it("offers nothing on finished orders", async () => {
    expect(await buttonsFor("admin", "received")).toEqual([]);
  });

  it("runs the action and reloads the list", async () => {
    const list = vi.spyOn(api, "purchaseOrders").mockResolvedValue(page([po("draft")]));
    const act = vi.spyOn(api, "purchaseOrderAction").mockResolvedValue({ ...po("submitted"), lines: [] });
    render(<Purchasing user={user("clerk")} />);
    fireEvent.click(await screen.findByRole("button", { name: "Submit" }));
    await waitFor(() => expect(act).toHaveBeenCalledWith("po1", "submit"));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
});

describe("App shell", () => {
  it("shows the login form when signed out", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "Authentication required"));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
  });

  it("shows the navigation the role can use", async () => {
    vi.spyOn(api, "me").mockResolvedValue(user("clerk"));
    vi.spyOn(api, "dashboard").mockResolvedValue({
      products: 1,
      lowStock: 0,
      openPurchaseOrders: 0,
      transfersInTransit: 0,
      movementsLast7Days: 0,
    });
    vi.spyOn(api, "products").mockResolvedValue(page([]));
    vi.spyOn(api, "movements").mockResolvedValue(page([]));
    render(<App />);
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Overview",
      "Inventory",
      "Movements",
      "Purchasing",
      "People",
    ]);
    expect(screen.getByText("clerk")).toBeTruthy();
  });

  it("signs in with the typed credentials and surfaces a login error", async () => {
    vi.spyOn(api, "me").mockRejectedValue(new ApiError(401, "UNAUTHORIZED", "x"));
    const login = vi.spyOn(api, "login").mockRejectedValueOnce(new ApiError(401, "UNAUTHORIZED", "Invalid credentials"));
    render(<App />);
    fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "clerk@example.test" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "demo-password-12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Invalid credentials");
    expect(login).toHaveBeenCalledWith({ email: "clerk@example.test", password: "demo-password-12345" });
  });
});
