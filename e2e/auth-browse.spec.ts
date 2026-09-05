import { test, expect } from "@playwright/test";
import { ensureUser, uploadTextFile, uniqueSuffix } from "./helpers/api";
import { uiLogin } from "./helpers/ui";

test.describe("auth + browse", () => {
  test("login shows my files and seeded file in the list", async ({ page }) => {
    const suffix = uniqueSuffix();
    const ownerName = `pw_owner_${suffix}`;
    const fileName = `hello_${suffix}.txt`;

    const owner = await ensureUser(ownerName, "PW Owner");
    await uploadTextFile(owner.jar, fileName, "hello from playwright");

    await uiLogin(page, ownerName);
    await expect(page.getByTestId("nav-my-files")).toBeVisible();
    await expect(
      page.getByRole("button", { name: new RegExp(`Файл: ${fileName}`) })
    ).toBeVisible();
  });
});
