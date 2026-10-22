import { employees, rewardCatalog, rewardLedger, type Database } from "@app/db";
import type {
  AwardPointsInput,
  CreateEmployeeInput,
  Employee,
  EmployeeRewardsResponse,
  Page,
  RewardItem,
  UpdateEmployeeInput,
} from "@app/shared";
import { count, desc, eq, sql } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import { conflict, notFound } from "../middleware/error-handler.js";

export type PeopleService = ReturnType<typeof createPeopleService>;

export function createPeopleService(db: Database) {
  const balances = new QueryBuilder()
    .select({ employeeId: rewardLedger.employeeId, points: sql<number>`sum(${rewardLedger.points})::int`.as("points") })
    .from(rewardLedger)
    .groupBy(rewardLedger.employeeId)
    .as("balances");
  const points = sql<number>`coalesce(${balances.points}, 0)`.mapWith(Number);

  const employeeSelect = () =>
    db
      .select({
        id: employees.id,
        name: employees.name,
        department: employees.department,
        title: employees.title,
        hiredOn: employees.hiredOn,
        active: employees.active,
        points,
      })
      .from(employees)
      .leftJoin(balances, eq(balances.employeeId, employees.id));

  async function getEmployee(id: string): Promise<Employee> {
    const [row] = await employeeSelect().where(eq(employees.id, id));
    if (!row) throw notFound("Employee not found");
    return row;
  }

  return {
    async list({ department, limit, offset }: { department?: string; limit: number; offset: number }): Promise<Page<Employee>> {
      const where = department ? eq(employees.department, department) : undefined;
      const [rows, [counted]] = await Promise.all([
        employeeSelect().where(where).orderBy(employees.name, employees.id).limit(limit).offset(offset),
        db.select({ n: count() }).from(employees).where(where),
      ]);
      return { items: rows, total: counted?.n ?? 0 };
    },

    get: getEmployee,

    async create(input: CreateEmployeeInput): Promise<Employee> {
      const [row] = await db.insert(employees).values(input).returning({ id: employees.id });
      if (!row) throw new Error("insert returned no row");
      return getEmployee(row.id);
    },

    async update(id: string, patch: UpdateEmployeeInput): Promise<Employee> {
      const [row] = await db.update(employees).set(patch).where(eq(employees.id, id)).returning({ id: employees.id });
      if (!row) throw notFound("Employee not found");
      return getEmployee(id);
    },

    // --- Rewards ---

    async listCatalog(): Promise<RewardItem[]> {
      return db.select().from(rewardCatalog).orderBy(rewardCatalog.pointsCost, rewardCatalog.name);
    },

    async createCatalogItem(input: { name: string; pointsCost: number }): Promise<RewardItem> {
      const [row] = await db.insert(rewardCatalog).values(input).onConflictDoNothing({ target: rewardCatalog.name }).returning();
      if (!row) throw conflict("A reward with this name already exists");
      return row;
    },

    async leaderboard(limit = 10): Promise<Employee[]> {
      return employeeSelect().where(eq(employees.active, true)).orderBy(desc(points), employees.name).limit(limit);
    },

    async rewardsFor(employeeId: string): Promise<EmployeeRewardsResponse> {
      await getEmployee(employeeId);
      const entries = await db
        .select({
          id: rewardLedger.id,
          kind: rewardLedger.kind,
          points: rewardLedger.points,
          reason: rewardLedger.reason,
          createdAt: rewardLedger.createdAt,
        })
        .from(rewardLedger)
        .where(eq(rewardLedger.employeeId, employeeId))
        .orderBy(desc(rewardLedger.createdAt), desc(rewardLedger.id))
        .limit(100);
      const [sum] = await db
        .select({ balance: sql<number>`coalesce(sum(${rewardLedger.points}), 0)::int`.mapWith(Number) })
        .from(rewardLedger)
        .where(eq(rewardLedger.employeeId, employeeId));
      return {
        balance: sum?.balance ?? 0,
        entries: entries.map((e) => ({ ...e, createdAt: e.createdAt.toISOString() })),
      };
    },

    async award(employeeId: string, { points: amount, reason }: AwardPointsInput, userId: string) {
      const employee = await getEmployee(employeeId);
      if (!employee.active) throw conflict("Employee is inactive");
      await db.insert(rewardLedger).values({ employeeId, kind: "earn", points: amount, reason, createdBy: userId });
      return this.rewardsFor(employeeId);
    },

    /** Locks the employee row so two concurrent redemptions cannot both spend the same points. */
    async redeem(employeeId: string, rewardId: string, userId: string) {
      await db.transaction(async (tx) => {
        const [employee] = await tx.select().from(employees).where(eq(employees.id, employeeId)).for("update");
        if (!employee) throw notFound("Employee not found");
        if (!employee.active) throw conflict("Employee is inactive");
        const [reward] = await tx.select().from(rewardCatalog).where(eq(rewardCatalog.id, rewardId));
        if (!reward) throw notFound("Reward not found");
        if (!reward.active) throw conflict("Reward is no longer available");
        const [sum] = await tx
          .select({ balance: sql<number>`coalesce(sum(${rewardLedger.points}), 0)::int`.mapWith(Number) })
          .from(rewardLedger)
          .where(eq(rewardLedger.employeeId, employeeId));
        const balance = sum?.balance ?? 0;
        if (balance < reward.pointsCost) {
          throw conflict("Not enough points", { balance, cost: reward.pointsCost });
        }
        await tx.insert(rewardLedger).values({
          employeeId,
          kind: "redeem",
          points: -reward.pointsCost,
          reason: `Redeemed: ${reward.name}`,
          rewardId,
          createdBy: userId,
        });
      });
      return this.rewardsFor(employeeId);
    },
  };
}
