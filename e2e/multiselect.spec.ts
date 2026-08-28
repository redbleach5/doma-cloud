import { test, expect } from "@playwright/test";
import { ensureUser, uploadTextFile, uniqueSuffix, apiJson } from "./helpers/api";
import { uiLogin } from "./helpers/ui";

test.describe("multiselect", () => {
  test("checkbox select + bulk trash; plain click still opens", async ({ page }) => {
    const suffix = uniqueSuffix();
    const ownerName = `pw_ms_${suffix}`;
    const fileA = `a_${suffix}.txt`;
    const fileB = `b_${suffix}.txt`;
    const folderName = `folder_${suffix}`;

    const owner = await ensureUser(ownerName, "MS Owner");
    await uploadTextFile(owner.jar, fileA, "aaa");
    await uploadTextFile(owner.jar, fileB, "bbb");
    await apiJson("POST", "/api/files/mkdir", {
      jar: owner.jar,
      body: { name: folderName },
      expect: 200,
    });

    await uiLogin(page, ownerName);

    const folderBtn = page.getByRole("button", { name: new RegExp(`Папка: ${folderName}`) });
    await expect(folderBtn).toBeVisible();

    await page.getByRole("button", { name: "Выбрать" }).click();
    await expect(page.getByTestId("selection-toolbar")).toBeVisible();

    await page.getByRole("checkbox", { name: `Выбрать «${fileA}»` }).click();
    await page.getByRole("checkbox", { name: `Выбрать «${fileB}»` }).click();

    await page.getByTestId("selection-toolbar").getByRole("button", { name: /В корзину/ }).click();
    await page.getByRole("button", { name: "В корзину" }).click();

    await expect(
      page.getByRole("button", { name: new RegExp(`Файл: ${fileA}`) })
    ).toHaveCount(0);

    await folderBtn.click();
    // Breadcrumb or empty folder state shows we're inside
    await expect(page.getByText(folderName).first()).toBeVisible();
  });
});
