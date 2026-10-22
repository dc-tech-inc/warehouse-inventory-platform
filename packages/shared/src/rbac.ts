import * as z from "zod";

export const Role = z.enum(["admin", "manager", "clerk"]);
export type Role = z.infer<typeof Role>;

export const PERMISSIONS = [
  "inventory:read",
  "inventory:write",
  "movements:create",
  "movements:adjust",
  "transfers:create",
  "purchasing:read",
  "purchasing:write",
  "purchasing:approve",
  "purchasing:receive",
  "employees:read",
  "employees:write",
  "rewards:read",
  "rewards:award",
  "rewards:manage",
  "users:manage",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const CLERK: readonly Permission[] = [
  "inventory:read",
  "movements:create",
  "transfers:create",
  "purchasing:read",
  "purchasing:write",
  "purchasing:receive",
  "rewards:read",
];
const MANAGER: readonly Permission[] = [
  ...CLERK,
  "inventory:write",
  "movements:adjust",
  "purchasing:approve",
  "employees:read",
  "employees:write",
  "rewards:award",
];

/** Role → permissions. Admin has everything; each role is a strict superset of the one below it. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, readonly Permission[]>> = {
  clerk: CLERK,
  manager: MANAGER,
  admin: PERMISSIONS,
};

export const can = (role: Role, permission: Permission): boolean => ROLE_PERMISSIONS[role].includes(permission);
