import {
  CreateMovementInput,
  CreateProductInput,
  CreateTransferInput,
  CreateWarehouseInput,
  can,
  IdParams,
  MovementListQuery,
  ProductListQuery,
  TransferListQuery,
  UpdateProductInput,
} from "@app/shared";
import { Router } from "express";
import { getAuth, guard } from "../middleware/auth.js";
import { forbidden } from "../middleware/error-handler.js";
import type { AuthService } from "../services/auth-service.js";
import type { InventoryService } from "../services/inventory-service.js";

export function inventoryRouter({ auth, inventory }: { auth: AuthService; inventory: InventoryService }): Router {
  const router = Router();

  router.get("/dashboard", guard(auth, "inventory:read"), async (_req, res) => {
    res.json(await inventory.dashboard());
  });

  router.get("/warehouses", guard(auth, "inventory:read"), async (_req, res) => {
    res.json({ items: await inventory.listWarehouses() });
  });
  router.post("/warehouses", guard(auth, "inventory:write"), async (req, res) => {
    res.status(201).json({ warehouse: await inventory.createWarehouse(CreateWarehouseInput.parse(req.body)) });
  });

  router.get("/products", guard(auth, "inventory:read"), async (req, res) => {
    res.json(await inventory.listProducts(ProductListQuery.parse(req.query)));
  });
  router.get("/products/:id", guard(auth, "inventory:read"), async (req, res) => {
    res.json({ product: await inventory.getProduct(IdParams.parse(req.params).id) });
  });
  router.post("/products", guard(auth, "inventory:write"), async (req, res) => {
    res.status(201).json({ product: await inventory.createProduct(CreateProductInput.parse(req.body)) });
  });
  router.patch("/products/:id", guard(auth, "inventory:write"), async (req, res) => {
    const { id } = IdParams.parse(req.params);
    res.json({ product: await inventory.updateProduct(id, UpdateProductInput.parse(req.body)) });
  });

  router.get("/movements", guard(auth, "inventory:read"), async (req, res) => {
    res.json(await inventory.listMovements(MovementListQuery.parse(req.query)));
  });
  router.post("/movements", guard(auth, "movements:create"), async (req, res) => {
    const input = CreateMovementInput.parse(req.body);
    const { user } = getAuth(res);
    // Clerks can receive and issue; correcting the count (adjustment) is a manager decision.
    if (input.kind === "adjustment" && !can(user.role, "movements:adjust")) throw forbidden();
    res.status(201).json({ movement: await inventory.createMovement(input, user.id) });
  });

  router.get("/transfers", guard(auth, "inventory:read"), async (req, res) => {
    res.json(await inventory.listTransfers(TransferListQuery.parse(req.query)));
  });
  router.post("/transfers", guard(auth, "transfers:create"), async (req, res) => {
    const transfer = await inventory.createTransfer(CreateTransferInput.parse(req.body), getAuth(res).user.id);
    res.status(201).json({ transfer });
  });
  for (const outcome of ["receive", "cancel"] as const) {
    router.post(`/transfers/:id/${outcome}`, guard(auth, "transfers:create"), async (req, res) => {
      const { id } = IdParams.parse(req.params);
      res.json({ transfer: await inventory.settleTransfer(id, outcome, getAuth(res).user.id) });
    });
  }

  return router;
}
