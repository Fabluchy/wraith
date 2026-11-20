/**
 * Deterministic Stellar wallet provider used by the browser matrix.
 *
 * It mirrors the small surface the harness needs — connect, disconnect, address
 * and signTransaction — without an extension, a network call, or a private key.
 * "Signing" returns a stable envelope marker; the fixture server only checks
 * that the transaction reached it signed, and the provider counts signatures in
 * `window.__e2eSignCount` so tests can prove a rejected request was never
 * signed.
 *
 * URL knobs:
 *   ?wallet=none              no provider is installed (extension missing)
 *   ?scenario=reject-signature  signTransaction rejects like a user cancellation
 */
(() => {
  const params = new URLSearchParams(window.location.search);
  if (params.get("wallet") === "none") {
    // Leave window.wraithWallet undefined on purpose: this is the "no wallet
    // installed" path, not a broken fixture.
    return;
  }

  const ADDRESS = "GDWCO35QUYQLGO6P7OLW4BZWNMMGGUWNPLRVPLCBVG7YNVDZKUDIW4KN";
  const rejectsSigning = params.get("scenario") === "reject-signature";
  let connected = false;

  window.__e2eSignCount = 0;

  window.wraithWallet = {
    id: "e2e-deterministic",
    name: "E2E deterministic wallet",
    async connect() {
      connected = true;
      return { address: ADDRESS };
    },
    async disconnect() {
      connected = false;
    },
    isConnected() {
      return connected;
    },
    getAddress() {
      return connected ? ADDRESS : null;
    },
    async signTransaction(xdr) {
      if (rejectsSigning) {
        throw new Error("User declined to sign the transaction");
      }
      window.__e2eSignCount += 1;
      return { signedXdr: `e2e-signed:${xdr}`, signer: ADDRESS };
    },
  };
})();
