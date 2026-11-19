#!/usr/bin/env node
/**
 * Deterministic fixture server for the Playwright wallet matrix.
 *
 * It replaces the three things a browser wallet test normally reaches for:
 * the wallet extension (see `wallet-provider.js`), a Stellar RPC/Horizon
 * endpoint, and a database. Sends, vault claims and refunds mutate an
 * in-memory ledger that starts from the same numbers on every page load, so the
 * assertions in `e2e/tests/` do not depend on wall-clock time, network state or
 * a funded account.
 *
 * State is keyed by the `x-e2e-session` header the harness sets once per page
 * load, which keeps parallel Playwright workers (and retries) independent.
 *
 * Scenario knobs arrive in `x-e2e-scenario`, derived from `?scenario=` in the
 * harness URL. They are the failure paths: `send-failure`, `vault-locked` and
 * `reject-signature` (the last is enforced by the provider fixture).
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const FIXTURES = path.dirname(fileURLToPath(import.meta.url));
const HARNESS = path.join(FIXTURES, "..", "harness");
const PORT = Number(process.env.E2E_PORT ?? 4310);

/** Fixed accounts. Nothing here is funded; the ledger is in memory. */
export const ALICE = "GDWCO35QUYQLGO6P7OLW4BZWNMMGGUWNPLRVPLCBVG7YNVDZKUDIW4KN";
export const BOB = "GCXOO7OIJZ2HEOZODLOEISNVO6CBPK4PISRJCZYRFT37H7XGHDLB3C7O";

const OPENING_BALANCE = "100.0000000";
const VAULT_CLAIMABLE = "12.5000000";
const VAULT_REFUNDABLE = "3.0000000";

const SEEDED_TRANSFER = Object.freeze({
  direction: "incoming",
  displayAmount: "25.0000000",
  counterparty: BOB,
  txHash: "e2e-incoming-seeded",
});

const sessions = new Map();
const MAX_SESSIONS = 500;

function getSession(id) {
  let session = sessions.get(id);
  if (!session) {
    if (sessions.size >= MAX_SESSIONS) {
      // Drop the oldest worker's state; Playwright never revisits it.
      sessions.delete(sessions.keys().next().value);
    }
    session = {
      balance: OPENING_BALANCE,
      transfers: [SEEDED_TRANSFER],
      vaultClaimed: false,
    };
    sessions.set(id, session);
  }
  return session;
}

function sessionId(req) {
  const id = req.headers["x-e2e-session"];
  return typeof id === "string" && id.length > 0 ? id : "anonymous";
}

function scenario(req) {
  const value = req.headers["x-e2e-scenario"];
  return typeof value === "string" ? value : "happy";
}

/** Stellar amounts are 7-decimal strings; formatting lives in one place. */
function formatAmount(value) {
  return (Math.round(value * 1e7) / 1e7).toFixed(7);
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024) throw new Error("Request body too large");
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function walletPayload(session, req) {
  return {
    balance: session.balance,
    transfers: session.transfers,
    vault: {
      claimable: VAULT_CLAIMABLE,
      refundable: VAULT_REFUNDABLE,
      claimed: session.vaultClaimed,
      locked: scenario(req) === "vault-locked",
    },
  };
}

async function handleApi(req, res, pathname) {
  const session = getSession(sessionId(req));
  const currentScenario = scenario(req);

  if (req.method === "GET" && pathname === "/api/wallet") {
    return sendJson(res, 200, walletPayload(session, req));
  }

  if (req.method === "POST" && pathname === "/api/send") {
    // A representative upstream failure: the node accepted the request and then
    // the network call failed, so the client must not record an optimistic row.
    if (currentScenario === "send-failure") {
      return sendJson(res, 502, { error: "Upstream network unavailable" });
    }

    let body;
    try {
      body = await readJson(req);
    } catch {
      return sendJson(res, 400, { error: "Malformed request body" });
    }

    const { to, amount, signedXdr } = body;
    if (typeof signedXdr !== "string" || signedXdr.length === 0) {
      return sendJson(res, 400, { error: "Transaction was not signed" });
    }
    if (typeof to !== "string" || !/^G[A-Z0-9]{55}$/.test(to)) {
      return sendJson(res, 400, { error: "Enter a valid destination address" });
    }
    const value = Number(amount);
    if (typeof amount !== "string" || !Number.isFinite(value) || value <= 0) {
      return sendJson(res, 400, { error: "Enter an amount greater than zero" });
    }
    if (value > Number(session.balance)) {
      return sendJson(res, 400, { error: "Insufficient balance" });
    }

    session.balance = formatAmount(Number(session.balance) - value);
    session.transfers = [
      {
        direction: "outgoing",
        displayAmount: formatAmount(value),
        counterparty: to,
        txHash: `e2e-outgoing-${session.transfers.length}`,
      },
      ...session.transfers,
    ];
    return sendJson(res, 200, walletPayload(session, req));
  }

  if (req.method === "POST" && pathname === "/api/vault/claim") {
    if (currentScenario === "vault-locked") {
      return sendJson(res, 409, { error: "Vault is still locked until 2027-01-01" });
    }
    if (session.vaultClaimed) {
      return sendJson(res, 409, { error: "Vault already claimed" });
    }
    session.vaultClaimed = true;
    return sendJson(res, 200, { amount: VAULT_CLAIMABLE, ...walletPayload(session, req) });
  }

  if (req.method === "POST" && pathname === "/api/vault/refund") {
    if (currentScenario === "vault-locked") {
      return sendJson(res, 409, { error: "Vault is still locked until 2027-01-01" });
    }
    return sendJson(res, 200, { amount: VAULT_REFUNDABLE, ...walletPayload(session, req) });
  }

  return sendJson(res, 404, { error: `Unknown API route: ${pathname}` });
}

const STATIC_FILES = new Map([
  ["/", { file: path.join(HARNESS, "index.html"), type: "text/html; charset=utf-8" }],
  ["/index.html", { file: path.join(HARNESS, "index.html"), type: "text/html; charset=utf-8" }],
  ["/app.js", { file: path.join(HARNESS, "app.js"), type: "text/javascript; charset=utf-8" }],
  ["/app.css", { file: path.join(HARNESS, "app.css"), type: "text/css; charset=utf-8" }],
  [
    "/__e2e__/wallet-provider.js",
    { file: path.join(FIXTURES, "wallet-provider.js"), type: "text/javascript; charset=utf-8" },
  ],
]);

async function handleStatic(res, pathname) {
  const entry = STATIC_FILES.get(pathname);
  if (!entry) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const body = await readFile(entry.file);
    res.writeHead(200, {
      "content-type": entry.type,
      "cache-control": "no-store",
      "content-length": body.length,
    });
    res.end(body);
  } catch {
    res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    res.end("Fixture file missing");
  }
}

const server = createServer(async (req, res) => {
  const pathname = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`).pathname;
  try {
    if (pathname === "/healthz") {
      return sendJson(res, 200, { status: "ok" });
    }
    if (pathname.startsWith("/api/")) {
      return await handleApi(req, res, pathname);
    }
    return await handleStatic(res, pathname);
  } catch (error) {
    console.error("[e2e-fixture] unhandled error", error);
    if (!res.headersSent) sendJson(res, 500, { error: "Fixture server error" });
    else res.end();
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[e2e-fixture] listening on http://127.0.0.1:${PORT}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
