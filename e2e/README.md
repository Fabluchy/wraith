# Browser matrix

Playwright covers the wallet and transaction surface in Chromium, Firefox and
WebKit. `npm run test:e2e` runs all three; `npx playwright test --project=firefox`
runs one engine, which is how CI fans the matrix out.

## Why the harness exists

The wallet dApp itself lives outside this repository, so these tests run against
`e2e/harness/`, a page with the same connect/disconnect, send, receive and vault
contract. Its dependencies are all fakes that ship in this directory:

- `fixtures/wallet-provider.js` — a deterministic provider (connect, disconnect,
  address, signTransaction). No extension, no private key, no signing service.
- `fixtures/server.mjs` — an in-memory ledger with fixed balances, one seeded
  incoming transfer, a vault, and scenario switches for the failure paths. No
  database, no Horizon, no RPC, no network access.

Both start and end at known values, and state is isolated per page load, so
tests never depend on ordering or on each other.

## Failure paths

| Scenario            | Where it is enforced               | Covered by                            |
| ------------------- | ---------------------------------- | ------------------------------------- |
| `send-failure`      | fixture server returns 502         | `transactions.spec.ts`                |
| `vault-locked`      | claim and refund return 409        | `vault.spec.ts`                       |
| `reject-signature`  | provider throws on signTransaction | `wallet.spec.ts`                      |
| `?wallet=none`      | provider is not installed          | `wallet.spec.ts`                      |

Pass a scenario as a query string through the helpers in
`fixtures/harness.ts`; the harness forwards it on every fixture-API request.

## Engine-specific expectations

- Clipboard contents are asserted in Chromium only: Playwright can grant
  clipboard permissions and read the clipboard back there, and nowhere else.
  Firefox and WebKit still assert the user-visible copy status.
- Every other spec is engine-agnostic on purpose. When a difference is real,
  express it as `test.skip(browserName === ...)` with the reason, not as a
  looser assertion for all engines.

## Artifacts

`trace: retain-on-failure`, `screenshot: only-on-failure` and
`video: retain-on-failure` keep artifacts only for the attempt that ended a
retry chain. The CI job uploads `test-results/` only when the job fails, so a
flaky retry that eventually passes leaves no upload behind.

## Running locally

```bash
npx playwright install --with-deps   # engines, plus system libraries
npm run test:e2e
```
