import { expect, test } from "@playwright/test";
import { connectWallet, openHarness } from "../fixtures/harness";

test.describe("vault claim and refund", () => {
  test("claims a matured vault exactly once", async ({ page }) => {
    await openHarness(page);
    await connectWallet(page);

    await expect(page.getByTestId("vault-claimable")).toHaveText("12.5000000");
    await page.getByTestId("vault-claim").click();
    await expect(page.getByTestId("vault-status")).toHaveText("Claimed 12.5000000 XLM");
    await expect(page.getByTestId("error")).toBeHidden();

    // A second click is a no-op as far as funds go, and it says why.
    await page.getByTestId("vault-claim").click();
    await expect(page.getByTestId("error")).toHaveText("Vault already claimed");
  });

  test("refunds the vault to the connected address", async ({ page }) => {
    await openHarness(page);
    await connectWallet(page);

    await expect(page.getByTestId("vault-refundable")).toHaveText("3.0000000");
    await page.getByTestId("vault-refund").click();

    await expect(page.getByTestId("vault-status")).toHaveText("Refunded 3.0000000 XLM");
    await expect(page.getByTestId("error")).toBeHidden();
  });

  test("explains a locked vault instead of claiming it", async ({ page }) => {
    await openHarness(page, { scenario: "vault-locked" });
    await connectWallet(page);

    await page.getByTestId("vault-claim").click();

    await expect(page.getByTestId("error")).toContainText("Vault is still locked");
    await expect(page.getByTestId("vault-status")).toHaveText("");
  });

  test("explains a locked vault instead of refunding it", async ({ page }) => {
    await openHarness(page, { scenario: "vault-locked" });
    await connectWallet(page);

    await page.getByTestId("vault-refund").click();

    await expect(page.getByTestId("error")).toContainText("Vault is still locked");
    await expect(page.getByTestId("vault-status")).toHaveText("");
  });
});
