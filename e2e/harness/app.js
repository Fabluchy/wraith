/**
 * Harness UI for the wallet matrix. It wires connect/disconnect, send, receive,
 * vault claim/refund and the activity list to the fixture API, and it is the
 * only place the suite reads UI state from.
 *
 * Everything is driven by explicit user actions: no timers, no polling, no
 * retry loops inside the page, so a Playwright assertion never races the app.
 */
(() => {
  const el = (id) => document.querySelector(`[data-testid="${id}"]`);
  const scenario = new URLSearchParams(window.location.search).get("scenario") ?? "happy";
  // One ledger per page load; a reload starts from the seeded numbers again.
  const session = crypto.randomUUID();

  const statusEl = el("wallet-status");
  const addressEl = el("wallet-address");
  const errorEl = el("error");
  const panelEl = el("wallet-panel");
  const receiveEl = el("receive-address");
  const copyStatusEl = el("copy-status");
  const balanceEl = el("balance");
  const transfersEl = el("transfers");
  const sendForm = el("send-form");
  const sendToEl = el("send-to");
  const sendAmountEl = el("send-amount");
  const sendStatusEl = el("send-status");
  const vaultClaimableEl = el("vault-claimable");
  const vaultRefundableEl = el("vault-refundable");
  const vaultStatusEl = el("vault-status");

  let connectedAddress = null;

  function setError(message) {
    errorEl.textContent = message ?? "";
    errorEl.hidden = !message;
  }

  async function api(path, init = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-e2e-session": session,
        "x-e2e-scenario": scenario,
        ...(init.headers ?? {}),
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(body.error ?? `Request failed with status ${response.status}`);
    }
    return body;
  }

  function renderTransfers(transfers) {
    transfersEl.replaceChildren(
      ...transfers.map((transfer) => {
        const row = document.createElement("li");
        row.dataset.testid = "transfer";
        row.dataset.direction = transfer.direction;
        const label = transfer.direction === "incoming" ? "Incoming" : "Outgoing";
        const preposition = transfer.direction === "incoming" ? "from" : "to";
        row.textContent = `${label} ${transfer.displayAmount} XLM ${preposition} ${transfer.counterparty}`;
        row.title = transfer.txHash;
        return row;
      }),
    );
  }

  function renderVault(vault) {
    vaultClaimableEl.textContent = vault.claimable;
    vaultRefundableEl.textContent = vault.refundable;
  }

  function applyWallet(payload) {
    balanceEl.textContent = payload.balance;
    renderTransfers(payload.transfers);
    renderVault(payload.vault);
  }

  async function refresh() {
    applyWallet(await api("/api/wallet"));
  }

  function resetView() {
    panelEl.hidden = true;
    receiveEl.textContent = "";
    balanceEl.textContent = "0.0000000";
    transfersEl.replaceChildren();
    vaultClaimableEl.textContent = "—";
    vaultRefundableEl.textContent = "—";
    copyStatusEl.textContent = "";
    sendStatusEl.textContent = "";
    vaultStatusEl.textContent = "";
  }

  el("connect").addEventListener("click", async () => {
    setError("");
    if (!window.wraithWallet) {
      setError("No Stellar wallet found. Install a wallet extension to continue.");
      return;
    }
    try {
      const { address } = await window.wraithWallet.connect();
      connectedAddress = address;
      statusEl.textContent = "Connected";
      addressEl.textContent = address;
      receiveEl.textContent = address;
      panelEl.hidden = false;
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  });

  el("disconnect").addEventListener("click", async () => {
    setError("");
    try {
      await window.wraithWallet?.disconnect();
    } finally {
      connectedAddress = null;
      statusEl.textContent = "Disconnected";
      addressEl.textContent = "—";
      resetView();
    }
  });

  el("copy-address").addEventListener("click", async () => {
    copyStatusEl.textContent = "";
    if (!connectedAddress) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(connectedAddress);
      } else {
        throw new Error("Clipboard API unavailable");
      }
      copyStatusEl.textContent = "Address copied";
    } catch {
      // Headless engines differ on clipboard permission; the fallback still
      // copies when the document allows it, and reports honestly when not.
      const scratch = document.createElement("textarea");
      scratch.value = connectedAddress;
      scratch.setAttribute("readonly", "");
      scratch.style.position = "fixed";
      scratch.style.opacity = "0";
      document.body.appendChild(scratch);
      scratch.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      scratch.remove();
      copyStatusEl.textContent = copied
        ? "Address copied"
        : "Copy failed — select the address to copy it manually";
    }
  });

  sendForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    setError("");
    sendStatusEl.textContent = "";
    if (!connectedAddress) {
      setError("Connect a wallet before sending.");
      return;
    }
    const to = sendToEl.value.trim();
    const amount = sendAmountEl.value.trim();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    const sendButton = el("send");
    sendButton.disabled = true;
    sendStatusEl.textContent = "Awaiting wallet signature…";
    try {
      const signed = await window.wraithWallet.signTransaction(
        `envelope:${connectedAddress}:${to}:${amount}`,
      );
      const payload = await api("/api/send", {
        method: "POST",
        body: JSON.stringify({ to, amount, signedXdr: signed.signedXdr }),
      });
      applyWallet(payload);
      sendStatusEl.textContent = `Sent ${amount} XLM to ${to}`;
      sendToEl.value = "";
      sendAmountEl.value = "";
    } catch (error) {
      // No optimistic row: the server response is the only source of activity.
      setError(error.message);
      sendStatusEl.textContent = "";
    } finally {
      sendButton.disabled = false;
    }
  });

  el("vault-claim").addEventListener("click", async () => {
    setError("");
    vaultStatusEl.textContent = "";
    try {
      const payload = await api("/api/vault/claim", { method: "POST" });
      applyWallet(payload);
      vaultStatusEl.textContent = `Claimed ${payload.amount} XLM`;
    } catch (error) {
      setError(error.message);
    }
  });

  el("vault-refund").addEventListener("click", async () => {
    setError("");
    vaultStatusEl.textContent = "";
    try {
      const payload = await api("/api/vault/refund", { method: "POST" });
      applyWallet(payload);
      vaultStatusEl.textContent = `Refunded ${payload.amount} XLM`;
    } catch (error) {
      setError(error.message);
    }
  });
})();
