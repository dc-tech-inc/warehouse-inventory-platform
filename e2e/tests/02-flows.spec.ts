import { expect, test } from "@playwright/test";
import { goTo, signIn, signOut } from "./support";

test("rejects a wrong password with a readable error", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Email").fill("clerk@example.test");
  await page.getByLabel("Password").fill("definitely the wrong one");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Invalid credentials");
});

test("a clerk books stock in, and is stopped from issuing more than is on hand", async ({ page }) => {
  await signIn(page, "clerk");
  await goTo(page, "Movements");
  const form = page.getByRole("form", { name: "Book stock" });

  await form.getByLabel("Product").selectOption({ label: "CART-FLAT · Flatbed cart" });
  await form.getByLabel("Warehouse").selectOption({ label: "RDU-1 · Raleigh" });
  await form.getByLabel("Quantity").fill("5");
  await form.getByRole("button", { name: "Book it" }).click();
  await expect(page.getByRole("status")).toHaveText("Booked +5 of CART-FLAT at RDU-1.");
  await expect(page.getByRole("row", { name: /CART-FLAT.*\+5/ }).first()).toBeVisible();

  await form.getByLabel("Kind").selectOption("issue");
  await form.getByLabel("Product").selectOption({ label: "PALLET-STD · Standard wooden pallet" });
  await form.getByLabel("Quantity").fill("999");
  await form.getByRole("button", { name: "Book it" }).click();
  await expect(form.getByRole("alert")).toHaveText("Insufficient stock");
});

test("roles see only what they may do", async ({ page }) => {
  await signIn(page, "clerk");
  await goTo(page, "Inventory");
  await expect(page.getByRole("heading", { name: "Products" })).toBeVisible();
  await expect(page.getByText("Add a product")).toHaveCount(0);
  await goTo(page, "People");
  await expect(page.getByRole("heading", { name: "Recognition board" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Employees" })).toHaveCount(0);
  await signOut(page);

  await signIn(page, "manager");
  await goTo(page, "Inventory");
  await expect(page.getByText("Add a product")).toBeVisible();
  await goTo(page, "People");
  await expect(page.getByRole("heading", { name: "Employees" })).toBeVisible();
});

test("a purchase order is raised by a clerk, approved by a manager and received by the clerk", async ({ page }) => {
  await signIn(page, "clerk");
  await goTo(page, "Purchasing");
  await page.getByText("New purchase order").click();
  await page.getByLabel("Supplier").selectOption({ label: "Northline Fasteners (synthetic)" });
  await page.getByLabel("Deliver to").selectOption({ label: "RDU-1 · Raleigh" });
  await page.getByLabel("Product").selectOption({ label: "SCAN-BATT · Scanner battery pack" });
  await page.getByLabel("Qty").fill("7");
  await page.getByLabel("Unit cost (USD)").fill("2.50");
  await page.getByRole("button", { name: "Create draft" }).click();

  const row = page.getByRole("row").filter({ hasText: "$17.50" });
  await expect(row).toContainText("draft");
  await expect(row.getByRole("button", { name: "Approve" })).toHaveCount(0); // a clerk cannot approve
  await row.getByRole("button", { name: "Submit" }).click();
  await expect(row).toContainText("submitted");
  await signOut(page);

  await signIn(page, "manager");
  await goTo(page, "Purchasing");
  await page.getByRole("row").filter({ hasText: "$17.50" }).getByRole("button", { name: "Approve" }).click();
  await expect(page.getByRole("row").filter({ hasText: "$17.50" })).toContainText("approved");
  await signOut(page);

  await signIn(page, "clerk");
  await goTo(page, "Purchasing");
  await page.getByRole("row").filter({ hasText: "$17.50" }).getByRole("button", { name: "Receive stock" }).click();
  await expect(page.getByRole("row").filter({ hasText: "$17.50" })).toContainText("received");

  await goTo(page, "Movements");
  await expect(page.getByRole("row", { name: /SCAN-BATT.*Received PO-/ }).first()).toBeVisible();
});

test("a manager awards points and the balance shows on the ledger", async ({ page }) => {
  await signIn(page, "manager");
  await goTo(page, "People");
  await page.getByRole("row", { name: /Jordan Ellis/ }).getByRole("button", { name: "Rewards" }).click();
  await page.getByLabel("Points").fill("15");
  await page.getByLabel("Reason").fill("Closed out the dock audit");
  await page.getByRole("button", { name: "Award", exact: true }).click();
  await expect(page.getByRole("cell", { name: "Closed out the dock audit" })).toBeVisible();
});
