import { test, expect } from "@playwright/test";
import {
  ensureUser,
  uploadTextFile,
  createPasswordShare,
  uniqueSuffix,
  E2E_SHARE_PASS,
} from "./helpers/api";

test.describe("password-protected public share", () => {
  test("password gate unlocks download", async ({ page }) => {
    const suffix = uniqueSuffix();
    const ownerName = `pw_link_${suffix}`;
    const fileName = `secret_${suffix}.txt`;

    const owner = await ensureUser(ownerName, "PW Link Owner");
    const file = await uploadTextFile(owner.jar, fileName, "top secret e2e");
    const { token } = await createPasswordShare(owner.jar, file.id);

    await page.goto(`/s/${token}`);
    await expect(page.getByRole("heading", { name: "Защищено паролем" })).toBeVisible();

    // Wrong password keeps the gate.
    await page.getByTestId("share-page-password").fill("wrong-password");
    await page.getByTestId("share-page-open").click();
    await expect(page.getByRole("heading", { name: "Защищено паролем" })).toBeVisible();

    await page.getByTestId("share-page-password").fill(E2E_SHARE_PASS);
    await page.getByTestId("share-page-open").click();

    await expect(page.getByText(fileName)).toBeVisible();
    await expect(page.getByTestId("share-page-download")).toBeVisible();
  });
});
