import * as z from "zod";
import { PageQuery, safeText } from "./common.js";

export const Employee = z
  .object({
    id: z.uuid(),
    name: z.string(),
    department: z.string(),
    title: z.string(),
    hiredOn: z.iso.date(),
    active: z.boolean(),
    points: z.number().int(),
  })
  .meta({ id: "Employee" });
export type Employee = z.infer<typeof Employee>;

export const CreateEmployeeInput = z
  .object({ name: safeText(100), department: safeText(60), title: safeText(80), hiredOn: z.iso.date() })
  .meta({ id: "CreateEmployeeInput" });
export type CreateEmployeeInput = z.infer<typeof CreateEmployeeInput>;

export const UpdateEmployeeInput = z
  .object({ department: safeText(60).optional(), title: safeText(80).optional(), active: z.boolean().optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), { error: "Provide at least one field" })
  .meta({ id: "UpdateEmployeeInput" });
export type UpdateEmployeeInput = z.infer<typeof UpdateEmployeeInput>;

export const EmployeeListQuery = PageQuery.extend({ department: z.string().trim().max(60).optional() });
export const EmployeeListResponse = z
  .object({ items: z.array(Employee), total: z.number().int() })
  .meta({ id: "EmployeeListResponse" });
export const EmployeeResponse = z.object({ employee: Employee }).meta({ id: "EmployeeResponse" });

export const RewardItem = z
  .object({ id: z.uuid(), name: z.string(), pointsCost: z.number().int(), active: z.boolean() })
  .meta({ id: "RewardItem" });
export type RewardItem = z.infer<typeof RewardItem>;

export const CreateRewardItemInput = z
  .object({ name: safeText(100), pointsCost: z.number().int().min(1).max(100_000) })
  .meta({ id: "CreateRewardItemInput" });
export const RewardCatalogResponse = z.object({ items: z.array(RewardItem) }).meta({ id: "RewardCatalogResponse" });
export const RewardItemResponse = z.object({ reward: RewardItem }).meta({ id: "RewardItemResponse" });

export const LedgerEntry = z
  .object({
    id: z.uuid(),
    kind: z.enum(["earn", "redeem"]),
    points: z.number().int(),
    reason: z.string(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: "LedgerEntry" });
export type LedgerEntry = z.infer<typeof LedgerEntry>;

export const AwardPointsInput = z
  .object({ points: z.number().int().min(1).max(1000), reason: safeText(200) })
  .meta({ id: "AwardPointsInput" });
export type AwardPointsInput = z.infer<typeof AwardPointsInput>;

export const RedeemInput = z.object({ rewardId: z.uuid() }).meta({ id: "RedeemInput" });

export const EmployeeRewardsResponse = z
  .object({ balance: z.number().int(), entries: z.array(LedgerEntry) })
  .meta({ id: "EmployeeRewardsResponse" });
export type EmployeeRewardsResponse = z.infer<typeof EmployeeRewardsResponse>;
