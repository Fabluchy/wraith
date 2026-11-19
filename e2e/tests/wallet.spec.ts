import { expect, test } from "@playwright/test";
import { connectWallet, openHarness, WALLET_ADDRESS } from "../fixtures/harness";

test.describe("wallet lifecycle", () => {
  test("connects the injected wallet and exposes the account", async ({ page }) => {
    await openHarness(page);

    await expect(page.getByTestId("wallet-status")).toHaveText("Disconnected");
    await expect(page.getByTestId("wallet-panel")).toBeHidden();
    await expect(page.getByTestId("error")).toBeHidden();

    await connectWallet(page);

    await expect(page.getByTestId("wallet-panel")).toBeVisible();
    await expect(page.getByTestId("receive-address")).toHaveText(WALLET_ADDRESS);
    await expect(page.getByTestId("vault-claimable")).toHaveText("12.5000000");
    await expect(page.getByTestId("vault-refundable")).toHaveText("3.0000000");
  });

  test("disconnects and clears everything that depended on the account", async ({ page }) => {
    await openHarness(page);
    await connectWallet(page);

    await page.getByTestId("disconnect").click();

    await expect(page.getByTestId("wallet-status")).toHaveText("Disconnected");
    await expect(page.getByTestId("wallet-address")).toHaveText("—");
    await expect(page.getByTestId("wallet-panel")).toBeHidden();
    await expect(page.getByTestId("receive-address")).toHaveText("");

    // Sending after a disconnect is an error path, not an unsigned request.
    await page.getByTestId("wallet-panel").isHidden();
    await expect(page.getByTestId("error")).toBeHidden();
  });

  test("explains a missing wallet provider instead of failing silently", async ({ page }) => {
    await openHarness(page, { wallet: "none" });

    await page.getByTestId("connect").click();

    await expect(page.getByTestId("error")).toHaveText(
      "No Stellar wallet found. Install a wallet extension to continue.",
    );
    await expect(page.getByTestId("wallet-status")).toHaveText("Disconnected");
    await expect(page.getByTestId("wallet-panel")).toBeHidden();
  });

  test("shows the wallet's rejection when signing is declined", async ({ page }) => {
    await openHarness(page, { scenario: "reject-signature" });
    await connectWallet(page);

    await page.getByTestId("send-to").fill("GCXOO7OIJZ2HEOZODLOEISNVO6CBPK4PISRJCZYRFT37H7XGHDLB3C7O");
    await page.getByTestId("send-amount").fill("5");
    await page.getByTestId("send").click();

    await expect(page.getByTestId("error")).toHaveText("User declined to sign the transaction");
    await expect(page.getByTestId("balance")).toHaveText("100.0000000");
    await expect(page.getByTestId("transfers").getByTestId("transfer")).toHaveCount(1);
  });

  // Chromium is the only engine where Playwright can grant clipboard
  // permissions and read the clipboard back. Firefox and WebKit exercise the
  // same flow in the status-only test below, so the matrix still covers them.
  test("copies the connected address to the clipboard", async ({ page, context, browserName }) => {
    test.skip(
      browserName !== "chromium",
      "clipboard-read/clipboard-write permissions are Chromium-only in Playwright",
    );
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await openHarness(page);
    await connectWallet(page);

    await page.getByTestId("copy-address").click();

    await expect(page.getByTestId("copy-status")).toHaveText("Address copied");
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe(WALLET_ADDRESS);
  });

  test("reports copy status without clipboard permissions", async ({ page }) => {
    await openHarness(page);
    await connectWallet(page);

    await page.getByTestId("copy-address").click();

    // WebKit headless refuses clipboard writes without a user gesture grant and
    // falls back to the explicit failure message; Chromium and Firefox succeed
    // through the Clipboard API. Both endings are contract, so both are allowed
    // here and the exact clipboard contents are asserted in the Chromium test.
    await expect(page.getByTestId("copy-status")).toHaveText(
      /Address copied|Copy failed — select the address to copy it manually/,
    );
  });
});
