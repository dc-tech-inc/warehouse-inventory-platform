import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, queryString } from "../src/api/client";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const mockFetch = (response: Response) => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("queryString", () => {
  it("skips undefined and empty values and encodes the rest", () => {
    expect(queryString({})).toBe("");
    expect(queryString({ q: undefined, lowStock: undefined })).toBe("");
    expect(queryString({ q: "", limit: 10 })).toBe("?limit=10");
    expect(queryString({ q: "50% off", lowStock: false, offset: 0 })).toBe("?q=50%25+off&lowStock=false&offset=0");
  });
});

describe("api client", () => {
  it("sends JSON with credentials and unwraps the payload", async () => {
    const fetchMock = mockFetch(jsonResponse(201, { movement: { id: "m1", delta: 5 } }));

    const movement = await api.createMovement({ kind: "receipt", productId: "p", warehouseId: "w", quantity: 5 });

    expect(movement).toEqual({ id: "m1", delta: 5 });
    expect(fetchMock).toHaveBeenCalledWith("/api/movements", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "receipt", productId: "p", warehouseId: "w", quantity: 5 }),
    });
  });

  it("builds filters and paging into the query string", async () => {
    const fetchMock = mockFetch(jsonResponse(200, { items: [], total: 0 }));
    await api.products({ q: "bolt", lowStock: true, limit: 15, offset: 30 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/products?q=bolt&lowStock=true&limit=15&offset=30");
  });

  it("encodes path ids and uses the workflow action as the last segment", async () => {
    const fetchMock = mockFetch(jsonResponse(200, { purchaseOrder: { id: "a/b" } }));
    await api.purchaseOrderAction("a/b", "approve");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/purchase-orders/a%2Fb/approve");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: "POST" });
  });

  it("resolves to undefined on 204", async () => {
    mockFetch(new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
  });

  it("throws a typed ApiError from the error envelope", async () => {
    mockFetch(jsonResponse(409, { error: { code: "CONFLICT", message: "Insufficient stock", details: { available: 2 } } }));
    const error = await api.settleTransfer("t1", "receive").catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 409, code: "CONFLICT", message: "Insufficient stock", details: { available: 2 } });
  });

  it("falls back to INTERNAL when the body is not the envelope", async () => {
    mockFetch(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(api.me()).rejects.toMatchObject({ status: 502, code: "INTERNAL" });
  });
});
