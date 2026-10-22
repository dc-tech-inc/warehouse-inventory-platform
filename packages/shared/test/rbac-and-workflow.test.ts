import { describe, expect, it } from "vitest";
import {
  can,
  nextStatus,
  PERMISSIONS,
  PurchaseOrderAction,
  PurchaseOrderStatus,
  ROLE_PERMISSIONS,
  Role,
} from "../src/index.js";

describe("RBAC", () => {
  it("gives admin every permission", () => {
    for (const permission of PERMISSIONS) expect(can("admin", permission)).toBe(true);
  });

  it("makes each role a strict superset of the one below it", () => {
    const clerk = new Set(ROLE_PERMISSIONS.clerk);
    const manager = new Set(ROLE_PERMISSIONS.manager);
    for (const p of clerk) expect(manager.has(p)).toBe(true);
    expect(manager.size).toBeGreaterThan(clerk.size);
    expect(ROLE_PERMISSIONS.admin.length).toBeGreaterThan(manager.size);
  });

  it.each([
    ["clerk", "movements:create", true],
    ["clerk", "movements:adjust", false],
    ["clerk", "purchasing:approve", false],
    ["clerk", "employees:read", false],
    ["clerk", "rewards:read", true],
    ["manager", "movements:adjust", true],
    ["manager", "purchasing:approve", true],
    ["manager", "employees:write", true],
    ["manager", "users:manage", false],
    ["manager", "rewards:manage", false],
  ] as const)("%s / %s -> %s", (role, permission, expected) => {
    expect(can(role, permission)).toBe(expected);
  });

  it("only lists permissions that exist", () => {
    for (const role of Role.options) {
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });
});

describe("purchase order workflow", () => {
  it("walks the happy path draft -> submitted -> approved -> received", () => {
    expect(nextStatus("draft", "submit")).toBe("submitted");
    expect(nextStatus("submitted", "approve")).toBe("approved");
    expect(nextStatus("approved", "receive")).toBe("received");
  });

  it("allows cancelling until the goods are received", () => {
    expect(nextStatus("draft", "cancel")).toBe("cancelled");
    expect(nextStatus("submitted", "cancel")).toBe("cancelled");
    expect(nextStatus("approved", "cancel")).toBe("cancelled");
    expect(nextStatus("received", "cancel")).toBeNull();
  });

  it("refuses skipping steps", () => {
    expect(nextStatus("draft", "approve")).toBeNull();
    expect(nextStatus("draft", "receive")).toBeNull();
    expect(nextStatus("submitted", "receive")).toBeNull();
    expect(nextStatus("approved", "submit")).toBeNull();
  });

  it("treats received and cancelled as terminal", () => {
    for (const action of PurchaseOrderAction.options) {
      expect(nextStatus("received", action)).toBeNull();
      expect(nextStatus("cancelled", action)).toBeNull();
    }
  });

  it("only produces known statuses", () => {
    for (const from of PurchaseOrderStatus.options) {
      for (const action of PurchaseOrderAction.options) {
        const to = nextStatus(from, action);
        if (to) expect(PurchaseOrderStatus.options).toContain(to);
      }
    }
  });
});
