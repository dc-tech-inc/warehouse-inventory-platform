import { expect, type Page } from "@playwright/test";
import { DEMO_PASSWORD } from "../constants";

export type DemoRole = "admin" | "manager" | "clerk";

export async function signIn(page: Page, role: DemoRole) {
  await page.goto("/");
  await page.getByLabel("Email").fill(`${role}@example.test`);
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

export async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
}

export const goTo = (page: Page, name: string) => page.getByRole("navigation", { name: "Main" }).getByRole("link", { name }).click();

/** Screenshots land in docs/screenshots and are what the README embeds. */
export const SHOTS = "../docs/screenshots";
