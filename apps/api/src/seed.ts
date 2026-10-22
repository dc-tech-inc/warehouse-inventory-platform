import { warehouses, type Database } from "@app/db";
import { count } from "drizzle-orm";
import { createAuthService } from "./services/auth-service.js";
import { createInventoryService } from "./services/inventory-service.js";
import { createPeopleService } from "./services/people-service.js";
import { createPurchasingService } from "./services/purchasing-service.js";

/**
 * Demo data. Every name, SKU, supplier and employee below is invented (synthetic); nothing is derived from a
 * real company, customer or person. Accounts use the reserved example.test domain.
 */
export const DEMO_ACCOUNTS = [
  { email: "admin@example.test", name: "Avery Admin (synthetic)", role: "admin" },
  { email: "manager@example.test", name: "Morgan Manager (synthetic)", role: "manager" },
  { email: "clerk@example.test", name: "Casey Clerk (synthetic)", role: "clerk" },
] as const;

const PRODUCTS: [sku: string, name: string, unit: string, reorder: number, costCents: number][] = [
  ["BOLT-M8-40", "Hex bolt M8 x 40 mm", "box of 100", 20, 1850],
  ["NUT-M8", "Hex nut M8", "box of 100", 20, 900],
  ["WASH-M8", "Flat washer M8", "box of 200", 15, 640],
  ["PALLET-STD", "Standard wooden pallet", "each", 40, 1450],
  ["WRAP-STRETCH", "Stretch wrap 500 mm", "roll", 30, 1175],
  ["TAPE-PACK-48", "Packing tape 48 mm", "case of 36", 12, 3290],
  ["BOX-S", "Shipping box small", "bundle of 25", 25, 1380],
  ["BOX-M", "Shipping box medium", "bundle of 25", 25, 1960],
  ["BOX-L", "Shipping box large", "bundle of 15", 18, 2240],
  ["LABEL-4X6", "Thermal label 4 x 6 in", "roll", 40, 410],
  ["GLOVE-L", "Work gloves, large", "pair", 60, 285],
  ["VEST-HV", "High-visibility vest", "each", 20, 760],
  ["SCAN-BATT", "Scanner battery pack", "each", 6, 4100],
  ["STRAP-TIE", "Ratchet tie-down strap", "each", 25, 1295],
  ["CRATE-PLAS", "Stackable plastic crate", "each", 50, 890],
  ["SHELF-BRKT", "Shelf bracket, steel", "each", 30, 520],
  ["CART-FLAT", "Flatbed cart", "each", 4, 18900],
  ["BIN-PICK", "Pick bin, blue", "each", 80, 340],
  ["FILM-BUBBLE", "Bubble film 1 m", "roll", 10, 2380],
  ["TOTE-LID", "Tote lid", "each", 50, 260],
];

const WAREHOUSES = [
  { code: "RDU-1", name: "Raleigh Distribution", city: "Raleigh" },
  { code: "CLT-2", name: "Charlotte Cross-dock", city: "Charlotte" },
  { code: "SAV-3", name: "Savannah Port Annex", city: "Savannah" },
];

const SUPPLIERS = [
  { name: "Northline Fasteners (synthetic)", country: "US" },
  { name: "Harbor Packaging Co. (synthetic)", country: "US" },
  { name: "Tidewater Safety Supply (synthetic)", country: "CA" },
];

const EMPLOYEES: [string, string, string, string][] = [
  ["Jordan Ellis", "Receiving", "Receiving lead", "2023-02-13"],
  ["Riley Chen", "Receiving", "Dock associate", "2024-06-03"],
  ["Taylor Brooks", "Picking", "Picker", "2024-01-22"],
  ["Sam Okafor", "Picking", "Picker", "2024-09-09"],
  ["Devon Alvarez", "Shipping", "Shipping coordinator", "2022-11-07"],
  ["Quinn Patel", "Shipping", "Loader", "2025-03-17"],
  ["Harper Novak", "Inventory control", "Cycle counter", "2023-08-28"],
  ["Rowan Silva", "Inventory control", "Inventory analyst", "2021-05-10"],
  ["Skyler Ng", "Purchasing", "Buyer", "2022-02-14"],
  ["Emerson Reid", "Safety", "Safety officer", "2020-10-05"],
  ["Parker Dunn", "Picking", "Picker", "2025-07-21"],
  ["Logan Moreau", "Receiving", "Dock associate", "2025-01-06"],
];

const REWARDS = [
  { name: "Coffee voucher (synthetic)", pointsCost: 25 },
  { name: "Team lunch (synthetic)", pointsCost: 80 },
  { name: "Extra day off (synthetic)", pointsCost: 400 },
];

/** Small deterministic generator so every run produces the same demo data. */
function lcg(seed: number) {
  let state = seed;
  return (max: number) => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state % max;
  };
}

/** Fills an empty database with demo data. Does nothing (and says so) if warehouses already exist. */
export async function seedDemoData(db: Database, password: string, log: (msg: string) => void = () => {}): Promise<boolean> {
  const [existing] = await db.select({ n: count() }).from(warehouses);
  if ((existing?.n ?? 0) > 0) {
    log("Database already has data; seed skipped.");
    return false;
  }

  const auth = createAuthService(db);
  const inventory = createInventoryService(db);
  const purchasing = createPurchasingService(db);
  const people = createPeopleService(db);
  const rand = lcg(42);

  const accounts = [];
  for (const account of DEMO_ACCOUNTS) accounts.push(await auth.createUser({ ...account, password }));
  const [admin, manager, clerk] = accounts;
  if (!admin || !manager || !clerk) throw new Error("accounts not created");

  const whs = [];
  for (const w of WAREHOUSES) whs.push(await inventory.createWarehouse(w));
  const prods = [];
  for (const [sku, name, unit, reorderPoint, unitCostCents] of PRODUCTS) {
    prods.push(await inventory.createProduct({ sku, name, unit, reorderPoint, unitCostCents }));
  }

  // Opening stock: most products well above their reorder point, a few deliberately low so the demo shows alerts.
  for (const [i, product] of prods.entries()) {
    for (const warehouse of whs) {
      const base = product.reorderPoint || 5;
      const quantity = i % 7 === 3 ? Math.max(1, Math.floor(base / 4)) : base + rand(base * 2);
      await inventory.createMovement({ kind: "receipt", productId: product.id, warehouseId: warehouse.id, quantity, note: "Opening stock (synthetic)" }, clerk.id);
    }
  }
  // Some outbound activity and one cycle-count correction.
  for (let n = 0; n < 12; n++) {
    const product = prods[rand(prods.length)];
    const warehouse = whs[rand(whs.length)];
    if (product && warehouse) {
      await inventory.createMovement({ kind: "issue", productId: product.id, warehouseId: warehouse.id, quantity: 1 + rand(4), note: `Order ${1000 + n} (synthetic)` }, clerk.id).catch(() => {});
    }
  }
  const [first, second, third] = [prods[0], prods[1], prods[2]];
  const [rdu, clt, sav] = whs;
  if (first && rdu) {
    await inventory.createMovement({ kind: "adjustment", productId: first.id, warehouseId: rdu.id, quantity: -2, note: "Cycle count: 2 damaged boxes (synthetic)" }, manager.id);
  }
  if (second && rdu && clt) {
    const t = await inventory.createTransfer({ productId: second.id, fromWarehouseId: rdu.id, toWarehouseId: clt.id, quantity: 5 }, clerk.id);
    await inventory.settleTransfer(t.id, "receive", clerk.id);
  }
  if (third && clt && sav) {
    await inventory.createTransfer({ productId: third.id, fromWarehouseId: clt.id, toWarehouseId: sav.id, quantity: 3 }, clerk.id);
  }

  // Purchase orders in each workflow state.
  const suppliers = [];
  for (const s of SUPPLIERS) suppliers.push(await purchasing.createSupplier(s));
  const poLines = (offset: number) =>
    prods.slice(offset, offset + 3).map((p) => ({ productId: p.id, quantity: 20 + rand(60), unitCostCents: p.unitCostCents }));
  const target = rdu ?? whs[0];
  if (target && suppliers[0] && suppliers[1] && suppliers[2]) {
    const mk = (supplierIndex: number, offset: number) =>
      purchasing.create({ supplierId: suppliers[supplierIndex]?.id ?? "", warehouseId: target.id, lines: poLines(offset) }, clerk.id);
    const received = await mk(0, 0);
    await purchasing.act(received.id, "submit", clerk.id);
    await purchasing.act(received.id, "approve", manager.id);
    await purchasing.act(received.id, "receive", clerk.id);
    const approved = await mk(1, 6);
    await purchasing.act(approved.id, "submit", clerk.id);
    await purchasing.act(approved.id, "approve", manager.id);
    const submitted = await mk(2, 10);
    await purchasing.act(submitted.id, "submit", clerk.id);
    await mk(0, 14);
  }

  // People and rewards.
  const staff = [];
  for (const [name, department, title, hiredOn] of EMPLOYEES) {
    staff.push(await people.create({ name: `${name} (synthetic)`, department, title, hiredOn }));
  }
  const catalog = [];
  for (const r of REWARDS) catalog.push(await people.createCatalogItem(r));
  const reasons = ["Zero-error receiving shift", "Picked 500 lines with no mispicks", "Helped train a new hire", "Spotted a safety hazard", "Cycle count accuracy 100%"];
  for (const employee of staff) {
    for (let n = 0; n < 1 + rand(4); n++) {
      await people.award(employee.id, { points: 10 + rand(5) * 10, reason: reasons[rand(reasons.length)] ?? "Recognition" }, manager.id);
    }
  }
  const redeemer = staff[0];
  const coffee = catalog[0];
  if (redeemer && coffee) await people.redeem(redeemer.id, coffee.id, manager.id).catch(() => {});

  log(`Seeded ${DEMO_ACCOUNTS.length} accounts, ${whs.length} warehouses, ${prods.length} products, 4 purchase orders, ${staff.length} employees.`);
  return true;
}
