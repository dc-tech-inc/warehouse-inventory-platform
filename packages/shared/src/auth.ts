import * as z from "zod";
import { safeText } from "./common.js";
import { Role } from "./rbac.js";

const email = z.email().max(254).transform((value) => value.toLowerCase());

export const Credentials = z
  .object({ email, password: z.string().min(12).max(128) })
  .meta({ id: "Credentials" });
export type Credentials = z.input<typeof Credentials>;

export const PublicUser = z
  .object({ id: z.uuid(), email: z.email(), name: z.string(), role: Role })
  .meta({ id: "User" });
export type PublicUser = z.infer<typeof PublicUser>;

export const UserResponse = z.object({ user: PublicUser }).meta({ id: "UserResponse" });
export type UserResponse = z.infer<typeof UserResponse>;

export const CreateUserInput = z
  .object({ email, name: safeText(100), password: z.string().min(12).max(128), role: Role })
  .meta({ id: "CreateUserInput" });
export type CreateUserInput = z.input<typeof CreateUserInput>;

export const UpdateUserInput = z
  .object({ name: safeText(100).optional(), role: Role.optional() })
  .refine((v) => v.name !== undefined || v.role !== undefined, { error: "Provide at least one of: name, role" })
  .meta({ id: "UpdateUserInput" });
export type UpdateUserInput = z.infer<typeof UpdateUserInput>;

export const UserListResponse = z.object({ items: z.array(PublicUser) }).meta({ id: "UserListResponse" });
