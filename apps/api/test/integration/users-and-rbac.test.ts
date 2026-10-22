import request from "supertest";
import { expect, it } from "vitest";
import { describeDb, PASSWORD, signIn, useTestDb } from "./helpers.js";

describeDb("users and role enforcement (Postgres)", () => {
  const db = useTestDb();

  it("lets an admin create accounts that can then log in with their role", async () => {
    const app = db.app();
    const admin = await signIn(db, app, "admin");
    const created = await admin.agent
      .post("/api/users")
      .send({ email: "New.Hire@Example.test", name: "New Hire", password: PASSWORD, role: "clerk" })
      .expect(201);
    expect(created.body.user).toEqual({ id: expect.any(String), email: "new.hire@example.test", name: "New Hire", role: "clerk" });
    expect(JSON.stringify(created.body)).not.toMatch(/password|hash/i);

    const login = await request(app).post("/api/auth/login").send({ email: "new.hire@example.test", password: PASSWORD }).expect(200);
    expect(login.body.user.role).toBe("clerk");
    await admin.agent.post("/api/users").send({ email: "NEW.hire@example.test", name: "Dup", password: PASSWORD, role: "clerk" }).expect(409);
    expect((await admin.agent.get("/api/users").expect(200)).body.items).toHaveLength(2);
  });

  it("changes roles, but never your own", async () => {
    const app = db.app();
    const admin = await signIn(db, app, "admin");
    const clerk = await signIn(db, app, "clerk");
    await admin.agent.patch(`/api/users/${clerk.user.id}`).send({ role: "manager" }).expect(200);
    // The role is read from the database on every request, so the promotion applies to the live session.
    await clerk.agent.get("/api/employees").expect(200);
    await admin.agent.patch(`/api/users/${admin.user.id}`).send({ role: "clerk" }).expect(409);
    await admin.agent.patch(`/api/users/${admin.user.id}`).send({ name: "Renamed" }).expect(200);
    await admin.agent.patch("/api/users/6f1c2a52-6f9f-4b7a-9d0a-3a3a8f1d9e01").send({ role: "clerk" }).expect(404);
    await admin.agent.patch(`/api/users/${clerk.user.id}`).send({}).expect(400);
  });

  it("keeps account management for admins", async () => {
    const app = db.app();
    const manager = await signIn(db, app, "manager");
    const clerk = await signIn(db, app, "clerk");
    await manager.agent.get("/api/users").expect(403);
    await clerk.agent.post("/api/users").send({ email: "x@example.test", name: "X", password: PASSWORD, role: "admin" }).expect(403);
  });

  it("applies the permission map to representative routes", async () => {
    const app = db.app();
    const clerk = await signIn(db, app, "clerk");
    const manager = await signIn(db, app, "manager");
    const probes: [string, "get" | "post" | "patch", string][] = [
      ["inventory:write", "post", "/api/products"],
      ["inventory:write", "post", "/api/warehouses"],
      ["employees:read", "get", "/api/employees"],
      ["rewards:manage", "post", "/api/rewards/catalog"],
    ];
    for (const [, method, path] of probes) {
      const res = await clerk.agent[method](path).send({});
      expect(res.status, `${method} ${path} as clerk`).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    }
    // Managers pass the guard on the same routes (a 400 means validation ran, not that they were refused).
    expect((await manager.agent.post("/api/products").send({})).status).toBe(400);
    expect((await manager.agent.post("/api/rewards/catalog").send({})).status).toBe(403);
  });

  it("returns 401, not 403, when there is no session at all", async () => {
    const res = await request(db.app()).post("/api/products").send({});
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });
});
