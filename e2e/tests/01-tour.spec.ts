import { expect, test } from "@playwright/test";
import { goTo, SHOTS, signIn } from "./support";

// Walks every screen as a manager and writes the screenshots used in the README.
// File name starts with 01 so it runs first, on the pristine seed, and the screenshots are reproducible.
test("tour of the app as a manager", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-login.png` });

  await signIn(page, "manager");
  await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
  await expect(page.getByText("At or below reorder point")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reorder soon" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-overview.png`, fullPage: true });

  await goTo(page, "Inventory");
  await expect(page.getByRole("heading", { name: "Inventory" })).toBeVisible();
  await expect(page.getByRole("row", { name: /PALLET-STD/ })).toBeVisible();
  await page.getByRole("row", { name: /PALLET-STD/ }).getByRole("button", { name: "By warehouse" }).click();
  await expect(page.getByText("RDU-1").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-inventory.png`, fullPage: true });

  await goTo(page, "Movements");
  await expect(page.getByRole("heading", { name: "Movements" })).toBeVisible();
  await expect(page.getByRole("form", { name: "Book stock" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-movements.png`, fullPage: true });

  await goTo(page, "Purchasing");
  await expect(page.getByRole("heading", { name: "Purchasing" })).toBeVisible();
  await expect(page.getByRole("button", { name: "PO-000001" })).toBeVisible();
  await page.getByRole("button", { name: "PO-000001" }).click();
  await expect(page.getByRole("columnheader", { name: "Unit cost" }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-purchasing.png`, fullPage: true });

  await goTo(page, "People");
  await expect(page.getByText("All people on this page are synthetic demo data.")).toBeVisible();
  await page.getByRole("button", { name: "Rewards" }).first().click();
  await expect(page.getByRole("heading", { name: /reward ledger/ })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/06-people.png`, fullPage: true });
});
