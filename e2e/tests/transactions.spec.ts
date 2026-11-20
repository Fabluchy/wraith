import { expect, test } from "@playwright/test";
import {
  connectWallet,
  COUNTERPARTY_ADDRESS,
  openHarness,
  signatureCount,
  WALLET_ADDRESS,
} from "../fixtures/harness";

test.describe("send and receive", () => {
  test("receives the seeded incoming transfer at the connected address", async ({ page }) => {
    await openHarness(page);
    await connectWallet(page);

    await expect(page.getByTestId("receive-address")).toHaveText(WALLET_ADDRESS);
    const rows = page.getByTestId("transfers").getByTestId("transfer");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toHaveAttribute("data-direction", "incoming");
    await expect(rows.first()).toContainText("Incoming 25.0000000 XLM from " + COUNTERPARTY_ADDRESS);
  });

  test("signs once, debits the balance and records the outgoing transfer", async ({ page }) => {
    await openHarness(page);
    await connectWallet(page);

    await page.getByTestId("send-to").fill(COUNTERPARTY_ADDRESS);
    await page.getByTestId("send-amount").fill("5");
    await page.getByTestId("send").click();

    await expect(page.getByTestId("send-status")).toHaveText(
      `Sent 5 XLM to ${COUNTERPARTY_ADDRESS}`,
    );
    await expect(page.getByTestId("balance")).toHaveText("95.0000000");
    await expect(page.getByTestId("error")).toBeHidden();

    const rows = page.getByTestId("transfers").getByTestId("transfer");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toHaveAttribute("data-direction", "outgoing");
    await expect(rows.first()).toContainText(`Outgoing 5.0000000 XLM to ${COUNTERPARTY_ADDRESS}`);
    expect(await signatureCount(page)).toBe(1);

    // The form is cleared so a double submit cannot resend the same transfer.
    await expect(page.getByTestId("send-to")).toHaveValue("");
    await expect(page.getByTestId("send-amount")).toHaveValue("");
  });

  test("surfaces an upstream send failure without an optimistic entry", async ({ page }) => {
    await openHarness(page, { scenario: "send-failure" });
    await connectWallet(page);

    await page.getByTestId("send-to").fill(COUNTERPARTY_ADDRESS);
    await page.getByTestId("send-amount").fill("5");
    await page.getByTestId("send").click();

    await expect(page.getByTestId("error")).toHaveText("Upstream network unavailable");
    await expect(page.getByTestId("send-status")).toHaveText("");
    await expect(page.getByTestId("balance")).toHaveText("100.0000000");
    await expect(page.getByTestId("transfers").getByTestId("transfer")).toHaveCount(1);
  });

  test("rejects a non-positive amount before asking the wallet to sign", async ({ page }) => {
    await openHarness(page);
    await connectWallet(page);

    await page.getByTestId("send-to").fill(COUNTERPARTY_ADDRESS);
    await page.getByTestId("send-amount").fill("0");
    await page.getByTestId("send").click();

    await expect(page.getByTestId("error")).toHaveText("Enter an amount greater than zero.");
    expect(await signatureCount(page)).toBe(0);
    await expect(page.getByTestId("balance")).toHaveText("100.0000000");
  });

  test("rejects a malformed destination at the API boundary", async ({ page }) => {
    await openHarness(page);
    await connectWallet(page);

    await page.getByTestId("send-to").fill("not-a-stellar-address");
    await page.getByTestId("send-amount").fill("1");
    await page.getByTestId("send").click();

    await expect(page.getByTestId("error")).toHaveText("Enter a valid destination address");
    await expect(page.getByTestId("transfers").getByTestId("transfer")).toHaveCount(1);
  });
});
