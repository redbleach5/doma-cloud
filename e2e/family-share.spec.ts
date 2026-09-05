import { test, expect } from "@playwright/test";
import { ensureUser, uploadTextFile, uniqueSuffix } from "./helpers/api";
import { uiLogin } from "./helpers/ui";

test.describe("family share UI", () => {
  test("owner shares with guest via dialog; guest sees it in shared-with-me", async ({
    page,
  }) => {
    const suffix = uniqueSuffix();
    const ownerName = `pw_own_${suffix}`;
    const guestName = `pw_gst_${suffix}`;
    const guestDisplay = `Guest ${suffix}`;
    const fileName = `family_${suffix}.txt`;

    const owner = await ensureUser(ownerName, "PW Owner");
    await ensureUser(guestName, guestDisplay);
    await uploadTextFile(owner.jar, fileName, "shared with family");

    await uiLogin(page, ownerName);

    const fileRow = page.getByRole("button", {
      name: new RegExp(`Файл: ${fileName}`),
    });
    await expect(fileRow).toBeVisible();
    await fileRow.click({ button: "right" });

    await page.getByRole("menuitem", { name: "Поделиться…" }).click();
    await expect(page.getByText("Поделиться файлом")).toBeVisible();
    await page.getByTestId("share-tab-family").click();

    await page
      .getByRole("checkbox", { name: `Выбрать ${guestDisplay}` })
      .click();
    await page.getByTestId("share-open-selected").click();

    // Dialog closes after successful share (or stay with "уже открыто").
    await expect(
      page.getByText("уже открыто").or(page.getByText("Поделиться файлом"))
    ).toBeVisible({ timeout: 15_000 });

    // Close dialog if still open.
    const dialog = page.getByRole("dialog");
    if (await dialog.isVisible().catch(() => false)) {
      await page.keyboard.press("Escape");
    }

    // Guest side.
    await page.context().clearCookies();
    await uiLogin(page, guestName);
    await page.getByTestId("nav-shared-with-me").click();
    await expect(
      page.getByRole("button", { name: new RegExp(`Файл: ${fileName}`) })
    ).toBeVisible();
  });
});
