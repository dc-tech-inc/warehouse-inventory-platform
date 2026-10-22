import { describe, expect, it } from "vitest";
import { loadEnv } from "../../src/env.js";
import { readCookie } from "../../src/middleware/auth.js";
import { escapeLike, lowStockFlag } from "../../src/services/inventory-service.js";
import { formatPoNumber } from "../../src/services/purchasing-service.js";

describe("loadEnv", () => {
  it("applies defaults", () => {
    expect(loadEnv({ DATABASE_URL: "postgres://u:p@localhost:5432/db" })).toEqual({
      DATABASE_URL: "postgres://u:p@localhost:5432/db",
      PORT: 3000,
      WEB_ORIGIN: "http://localhost:5173",
      NODE_ENV: "development",
      LOG_LEVEL: "info",
    });
  });

  it("coerces PORT and fails fast on bad values", () => {
    expect(loadEnv({ DATABASE_URL: "postgresql://h/db", PORT: "8080" }).PORT).toBe(8080);
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
    expect(() => loadEnv({ DATABASE_URL: "postgres://h/db", PORT: "99999" })).toThrow(/PORT/);
    expect(() => loadEnv({ DATABASE_URL: "postgres://h/db", NODE_ENV: "staging" })).toThrow(/NODE_ENV/);
  });

  it("rejects non-postgres URLs without echoing the value", () => {
    const secret = "mysql://admin:hunter2-secret@db/app";
    expect(() => loadEnv({ DATABASE_URL: secret })).toThrow(/DATABASE_URL/);
    try {
      loadEnv({ DATABASE_URL: secret });
    } catch (err) {
      expect((err as Error).message).not.toContain("hunter2");
    }
  });
});

describe("readCookie", () => {
  it("finds a cookie among others", () => {
    expect(readCookie("theme=dark; sid=abc123; lang=en", "sid")).toBe("abc123");
  });

  it("decodes percent-encoding and ignores lookalike names", () => {
    expect(readCookie("xsid=nope; sid=a%2Bb", "sid")).toBe("a+b");
  });

  it("returns undefined when absent or malformed", () => {
    expect(readCookie(undefined, "sid")).toBeUndefined();
    expect(readCookie("theme=dark", "sid")).toBeUndefined();
    expect(readCookie("garbage; sid=%E0%A4%A", "sid")).toBeUndefined();
  });
});

describe("inventory helpers", () => {
  it("flags low stock at or below a positive reorder point only", () => {
    expect(lowStockFlag(5, 10)).toBe(true);
    expect(lowStockFlag(10, 10)).toBe(true);
    expect(lowStockFlag(11, 10)).toBe(false);
    expect(lowStockFlag(0, 0)).toBe(false);
  });

  it("escapes LIKE wildcards so searches are literal", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
    expect(escapeLike("plain")).toBe("plain");
  });

  it("formats purchase order numbers", () => {
    expect(formatPoNumber(7)).toBe("PO-000007");
    expect(formatPoNumber(1234567)).toBe("PO-1234567");
  });
});
