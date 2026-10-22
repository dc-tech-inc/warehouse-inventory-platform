import {
  CreatePurchaseOrderInput,
  CreateSupplierInput,
  IdParams,
  PurchaseOrderAction,
  PurchaseOrderListQuery,
  type Permission,
} from "@app/shared";
import { Router } from "express";
import { getAuth, guard } from "../middleware/auth.js";
import type { AuthService } from "../services/auth-service.js";
import type { PurchasingService } from "../services/purchasing-service.js";

/** Who may run each workflow step. Receiving stock is a floor task; approving and cancelling are not. */
export const ACTION_PERMISSION: Record<PurchaseOrderAction, Permission> = {
  submit: "purchasing:write",
  approve: "purchasing:approve",
  receive: "purchasing:receive",
  cancel: "purchasing:approve",
};

export function purchasingRouter({ auth, purchasing }: { auth: AuthService; purchasing: PurchasingService }): Router {
  const router = Router();

  router.get("/suppliers", guard(auth, "purchasing:read"), async (_req, res) => {
    res.json({ items: await purchasing.listSuppliers() });
  });
  router.post("/suppliers", guard(auth, "purchasing:write"), async (req, res) => {
    res.status(201).json({ supplier: await purchasing.createSupplier(CreateSupplierInput.parse(req.body)) });
  });

  router.get("/purchase-orders", guard(auth, "purchasing:read"), async (req, res) => {
    res.json(await purchasing.list(PurchaseOrderListQuery.parse(req.query)));
  });
  router.get("/purchase-orders/:id", guard(auth, "purchasing:read"), async (req, res) => {
    res.json({ purchaseOrder: await purchasing.get(IdParams.parse(req.params).id) });
  });
  router.post("/purchase-orders", guard(auth, "purchasing:write"), async (req, res) => {
    const po = await purchasing.create(CreatePurchaseOrderInput.parse(req.body), getAuth(res).user.id);
    res.status(201).json({ purchaseOrder: po });
  });

  for (const action of PurchaseOrderAction.options) {
    router.post(`/purchase-orders/:id/${action}`, guard(auth, ACTION_PERMISSION[action]), async (req, res) => {
      const { id } = IdParams.parse(req.params);
      res.json({ purchaseOrder: await purchasing.act(id, action, getAuth(res).user.id) });
    });
  }

  return router;
}
