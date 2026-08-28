import { test, expect } from "@playwright/test";
import {
  ensureUser,
  uploadBinaryFile,
  uniqueSuffix,
  JPEG_1X1,
} from "./helpers/api";
import { uiLogin } from "./helpers/ui";

test.describe("photo preview", () => {
  test("opens a JPEG in the preview dialog", async ({ page }) => {
    const suffix = uniqueSuffix();
    const ownerName = `pw_photo_${suffix}`;
    const fileName = `family_${suffix}.jpg`;

    const owner = await ensureUser(ownerName, "PW Photo");
    await uploadBinaryFile(owner.jar, fileName, JPEG_1X1, "image/jpeg");

    await uiLogin(page, ownerName);

    const fileRow = page.getByRole("button", {
      name: new RegExp(`Файл: ${fileName}`),
    });
    await expect(fileRow).toBeVisible();
    await fileRow.click();

    await expect(page.getByTestId("file-preview-dialog")).toBeVisible();
    const img = page.getByTestId("image-preview-img");
    await expect(img).toBeVisible();
    // Wait until the browser decoded the image (onLoad → opacity ready).
    await expect(page.getByTestId("image-preview")).toBeVisible();
    await expect
      .poll(async () => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
      .toBeGreaterThan(0);
  });
});
