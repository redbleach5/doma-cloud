import type { Page } from "@playwright/test";
import { E2E_PASS } from "./api";

/** Fill the login form and wait until the file browser shell is visible. */
export async function uiLogin(page: Page, username: string, password = E2E_PASS) {
  await page.goto("/");
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Войти" }).click();
  await page.getByTestId("nav-my-files").waitFor({ state: "visible" });
}
