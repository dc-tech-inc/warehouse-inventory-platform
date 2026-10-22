import { expect, it } from "vitest";
import { describeDb, signIn, useTestDb } from "./helpers.js";

describeDb("employees and rewards (Postgres)", () => {
  const db = useTestDb();

  async function setup() {
    const app = db.app();
    const manager = await signIn(db, app, "manager");
    const clerk = await signIn(db, app, "clerk");
    const admin = await signIn(db, app, "admin");
    const employee = await manager.agent
      .post("/api/employees")
      .send({ name: "Sam Rivera (synthetic)", department: "Receiving", title: "Lead", hiredOn: "2024-03-04" })
      .expect(201);
    return { manager, clerk, admin, employee: employee.body.employee as { id: string } };
  }

  it("creates, lists, filters and updates employees", async () => {
    const { manager, employee } = await setup();
    expect((await manager.agent.get(`/api/employees/${employee.id}`).expect(200)).body.employee).toMatchObject({
      name: "Sam Rivera (synthetic)",
      points: 0,
      active: true,
    });
    await manager.agent.post("/api/employees").send({ name: "Alex Kim (synthetic)", department: "Shipping", title: "Picker", hiredOn: "2025-01-10" }).expect(201);

    const all = await manager.agent.get("/api/employees").expect(200);
    expect(all.body.total).toBe(2);
    expect(all.body.items.map((e: { name: string }) => e.name)).toEqual(["Alex Kim (synthetic)", "Sam Rivera (synthetic)"]);
    expect((await manager.agent.get("/api/employees?department=Shipping").expect(200)).body.total).toBe(1);

    const patched = await manager.agent.patch(`/api/employees/${employee.id}`).send({ title: "Supervisor", active: false }).expect(200);
    expect(patched.body.employee).toMatchObject({ title: "Supervisor", active: false });
    await manager.agent.patch(`/api/employees/${employee.id}`).send({}).expect(400);
    await manager.agent.get("/api/employees/6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01").expect(404);
    await manager.agent.post("/api/employees").send({ name: "X", department: "Y", title: "Z", hiredOn: "2025-02-30" }).expect(400);
  });

  it("keeps employee records away from clerks", async () => {
    const { clerk, employee } = await setup();
    await clerk.agent.get("/api/employees").expect(403);
    await clerk.agent.get(`/api/employees/${employee.id}`).expect(403);
    await clerk.agent.post("/api/employees").send({ name: "N", department: "D", title: "T", hiredOn: "2025-01-01" }).expect(403);
  });

  it("awards points and keeps the ledger and balance in step", async () => {
    const { manager, employee } = await setup();
    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 50, reason: "Zero-defect week" }).expect(201);
    const res = await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 25, reason: "Trained a new hire" }).expect(201);
    expect(res.body.balance).toBe(75);
    expect(res.body.entries.map((e: { reason: string }) => e.reason)).toEqual(["Trained a new hire", "Zero-defect week"]);
    expect((await manager.agent.get(`/api/employees/${employee.id}`).expect(200)).body.employee.points).toBe(75);
  });

  it("validates awards and keeps them for managers", async () => {
    const { manager, clerk, employee } = await setup();
    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 0, reason: "x" }).expect(400);
    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 5000, reason: "x" }).expect(400);
    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 5 }).expect(400);
    await clerk.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 5, reason: "self-service" }).expect(403);
    await manager.agent.patch(`/api/employees/${employee.id}`).send({ active: false }).expect(200);
    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 5, reason: "late" }).expect(409);
  });

  it("redeems rewards only with enough points", async () => {
    const { manager, admin, employee } = await setup();
    const reward = await admin.agent.post("/api/rewards/catalog").send({ name: "Gift card (synthetic)", pointsCost: 60 }).expect(201);
    const rewardId = reward.body.reward.id as string;
    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 50, reason: "Start" }).expect(201);

    const short = await manager.agent.post(`/api/employees/${employee.id}/rewards/redeem`).send({ rewardId }).expect(409);
    expect(short.body.error.details).toEqual({ balance: 50, cost: 60 });

    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 20, reason: "More" }).expect(201);
    const ok = await manager.agent.post(`/api/employees/${employee.id}/rewards/redeem`).send({ rewardId }).expect(201);
    expect(ok.body.balance).toBe(10);
    expect(ok.body.entries[0]).toMatchObject({ kind: "redeem", points: -60, reason: "Redeemed: Gift card (synthetic)" });
  });

  it("serialises concurrent redemptions so points cannot be spent twice", async () => {
    const { manager, admin, employee } = await setup();
    const reward = await admin.agent.post("/api/rewards/catalog").send({ name: "Lunch (synthetic)", pointsCost: 40 }).expect(201);
    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 100, reason: "Seed" }).expect(201);

    const results = await Promise.all(
      Array.from({ length: 5 }, () => manager.agent.post(`/api/employees/${employee.id}/rewards/redeem`).send({ rewardId: reward.body.reward.id })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(2);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    const ledger = await manager.agent.get(`/api/employees/${employee.id}/rewards`).expect(200);
    expect(ledger.body.balance).toBe(20);
  });

  it("manages the catalog (admin only), lists it to everyone, and shows a leaderboard", async () => {
    const { manager, clerk, admin, employee } = await setup();
    await manager.agent.post("/api/rewards/catalog").send({ name: "Mug", pointsCost: 10 }).expect(403);
    await admin.agent.post("/api/rewards/catalog").send({ name: "Mug", pointsCost: 10 }).expect(201);
    await admin.agent.post("/api/rewards/catalog").send({ name: "Mug", pointsCost: 10 }).expect(409);
    await admin.agent.post("/api/rewards/catalog").send({ name: "Free", pointsCost: 0 }).expect(400);
    expect((await clerk.agent.get("/api/rewards/catalog").expect(200)).body.items).toHaveLength(1);

    const other = await manager.agent.post("/api/employees").send({ name: "Jo Park (synthetic)", department: "Shipping", title: "Picker", hiredOn: "2025-05-05" }).expect(201);
    await manager.agent.post(`/api/employees/${employee.id}/rewards/award`).send({ points: 10, reason: "a" }).expect(201);
    await manager.agent.post(`/api/employees/${other.body.employee.id}/rewards/award`).send({ points: 30, reason: "b" }).expect(201);
    const board = await clerk.agent.get("/api/rewards/leaderboard").expect(200);
    expect(board.body.items.map((e: { name: string; points: number }) => [e.name, e.points])).toEqual([
      ["Jo Park (synthetic)", 30],
      ["Sam Rivera (synthetic)", 10],
    ]);
  });

  it("blocks the ledger sign check at the database level", async () => {
    const { employee } = await setup();
    await expect(
      db.pool().query("INSERT INTO reward_ledger (employee_id, kind, points, reason) VALUES ($1, 'earn', -5, 'bad')", [employee.id]),
    ).rejects.toMatchObject({ code: "23514" });
  });
});
