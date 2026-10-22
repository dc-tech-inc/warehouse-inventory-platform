import {
  AwardPointsInput,
  CreateEmployeeInput,
  CreateRewardItemInput,
  EmployeeListQuery,
  IdParams,
  RedeemInput,
  UpdateEmployeeInput,
} from "@app/shared";
import { Router } from "express";
import { getAuth, guard } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { PeopleService } from "../services/people-service.js";

export function peopleRouter({ auth, people }: { auth: AuthService; people: PeopleService }): Router {
  const router = Router();

  router.get("/employees", guard(auth, "employees:read"), async (req, res) => {
    res.json(await people.list(EmployeeListQuery.parse(req.query)));
  });
  router.post("/employees", guard(auth, "employees:write"), async (req, res) => {
    res.status(201).json({ employee: await people.create(CreateEmployeeInput.parse(req.body)) });
  });
  router.get("/employees/:id", guard(auth, "employees:read"), async (req, res) => {
    res.json({ employee: await people.get(IdParams.parse(req.params).id) });
  });
  router.patch("/employees/:id", guard(auth, "employees:write"), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    res.json({ employee: await people.update(id, UpdateEmployeeInput.parse(req.body)) });
  });

  router.get("/rewards/catalog", guard(auth, "rewards:read"), async (_req, res) => {
    res.json({ items: await people.listCatalog() });
  });
  router.post("/rewards/catalog", guard(auth, "rewards:manage"), async (req, res) => {
    res.status(201).json({ reward: await people.createCatalogItem(CreateRewardItemInput.parse(req.body)) });
  });
  router.get("/rewards/leaderboard", guard(auth, "rewards:read"), async (_req, res) => {
    res.json({ items: await people.leaderboard() });
  });

  router.get("/employees/:id/rewards", guard(auth, "rewards:read"), async (req, res) => {
    res.json(await people.rewardsFor(IdParams.parse(req.params).id));
  });
  router.post("/employees/:id/rewards/award", guard(auth, "rewards:award"), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    res.status(201).json(await people.award(id, AwardPointsInput.parse(req.body), getAuth(res).user.id));
  });
  router.post("/employees/:id/rewards/redeem", guard(auth, "rewards:award"), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    res.status(201).json(await people.redeem(id, RedeemInput.parse(req.body).rewardId, getAuth(res).user.id));
  });

  return router;
}
