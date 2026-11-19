import { expect, type Page } from "@playwright/test";

/** The fixed account the provider fixture connects. */
export const WALLET_ADDRESS = "GDWCO35QUYQLGO6P7OLW4BZWNMMGGUWNPLRVPLCBVG7YNVDZKUDIW4KN";

/** A deterministic counterparty for send/receive assertions. */
export const COUNTERPARTY_ADDRESS = "GCXOO7OIJZ2HEOZODLOEISNVO6CBPK4PISRJCZYRFT37H7XGHDLB3C7O";

export interface HarnessOptions {
  /** Failure-path knob understood by the fixture server and provider. */
  scenario?: "send-failure" | "vault-locked" | "reject-signature";
  /** `none` simulates a browser with no Stellar wallet installed. */
  wallet?: "none";
}

/** Opens the harness with a fresh fixture ledger. */
export async function openHarness(page: Page, options: HarnessOptions = {}): Promise<void> {
  const search = new URLSearchParams();
  if (options.scenario) search.set("scenario", options.scenario);
  if (options.wallet) search.set("wallet", options.wallet);
  const query = search.toString();
  await page.goto(query ? `/?${query}` : "/");
}

/** Connects the fixture provider and waits for the account to be on screen. */
export async function connectWallet(page: Page): Promise<void> {
  await page.getByTestId("connect").click();
  await expect(page.getByTestId("wallet-status")).toHaveText("Connected");
  await expect(page.getByTestId("wallet-address")).toHaveText(WALLET_ADDRESS);
  await expect(page.getByTestId("balance")).toHaveText("100.0000000");
}

/** Number of signature requests the provider fixture has received. */
export async function signatureCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __e2eSignCount?: number }).__e2eSignCount ?? 0);
}
