import "dotenv/config";
import express from "express";
import helmet from "helmet";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const LIVE = process.env.PAYPAL_ENV === "live";
const PAYPAL_BASE = LIVE ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

const PRODUCT = Object.freeze({
  id: "realitystate-hunting-premium",
  name: "RealityState Hunting — Holographic Premium Bundle",
  price: "4.99",
  currency: "USD",
  file: path.join(__dirname, "private", "product", "RealityState-Hunting-Holographic.html")
});

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "https://www.paypal.com", "https://www.sandbox.paypal.com", "https://cdnjs.cloudflare.com"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://www.paypal.com", "https://www.sandbox.paypal.com", "https://api-m.paypal.com", "https://api-m.sandbox.paypal.com"],
      frameSrc: ["https://www.paypal.com", "https://www.sandbox.paypal.com"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === "production" ? [] : null
    }
  }
}));
app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public"), { index: "index.html" }));

function assertConfig() {
  const required = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "DOWNLOAD_TOKEN_SECRET"];
  const missing = required.filter(k => !process.env[k] || process.env[k].startsWith("replace_"));
  if (missing.length) throw new Error(`Missing configuration: ${missing.join(", ")}`);
  if (Buffer.byteLength(process.env.DOWNLOAD_TOKEN_SECRET, "utf8") < 32) {
    throw new Error("DOWNLOAD_TOKEN_SECRET must be at least 32 bytes.");
  }
}

async function paypalAccessToken() {
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    console.error("PayPal OAuth error", response.status);
    throw new Error("PayPal authentication failed.");
  }
  return data.access_token;
}

async function paypalRequest(endpoint, options = {}) {
  const token = await paypalAccessToken();
  const response = await fetch(`${PAYPAL_BASE}${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("PayPal API error", { endpoint, status: response.status, debugId: response.headers.get("paypal-debug-id") });
    throw new Error(`PayPal request failed (${response.status}).`);
  }
  return data;
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.DOWNLOAD_TOKEN_SECRET).update(body).digest("hex");
  return `${body}.${sig}`;
}
function constantTimeHexEqual(a, b) {
  const x = Buffer.from(a, "hex"), y = Buffer.from(b, "hex");
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function readToken(token) {
  if (typeof token !== "string" || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac("sha256", process.env.DOWNLOAD_TOKEN_SECRET).update(body).digest("hex");
  if (!constantTimeHexEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.productId !== PRODUCT.id || !Number.isInteger(payload.exp) || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

app.get("/api/config", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({
    clientId: process.env.PAYPAL_CLIENT_ID || "",
    environment: LIVE ? "live" : "sandbox",
    currency: PRODUCT.currency,
    product: { id: PRODUCT.id, name: PRODUCT.name, price: PRODUCT.price }
  });
});

app.post("/api/orders", async (_req, res) => {
  try {
    assertConfig();
    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
    const order = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      headers: { "PayPal-Request-Id": crypto.randomUUID() },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: PRODUCT.id,
          custom_id: PRODUCT.id,
          description: PRODUCT.name,
          amount: { currency_code: PRODUCT.currency, value: PRODUCT.price }
        }],
        application_context: {
          brand_name: "RealityStateOS",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: `${baseUrl}/?payment=success`,
          cancel_url: `${baseUrl}/?payment=cancelled`
        }
      })
    });
    if (!order.id) throw new Error("PayPal did not return an order ID.");
    res.set("Cache-Control", "no-store");
    res.status(201).json({ id: order.id });
  } catch (e) {
    console.error("Create order failed:", e.message);
    res.status(502).json({ error: "Checkout could not be started. Please try again later." });
  }
});

app.post("/api/orders/:orderId/capture", async (req, res) => {
  const orderId = req.params.orderId;
  if (!/^[A-Z0-9-]{8,80}$/i.test(orderId)) return res.status(400).json({ error: "Invalid order ID." });
  try {
    assertConfig();
    const result = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
      method: "POST",
      headers: { "PayPal-Request-Id": `capture-${orderId}` },
      body: "{}"
    });

    const unit = result.purchase_units?.find(u => u.reference_id === PRODUCT.id || u.custom_id === PRODUCT.id);
    const capture = unit?.payments?.captures?.find(c => c.status === "COMPLETED");
    const amount = capture?.amount;
    if (result.status !== "COMPLETED" || !capture ||
        amount?.currency_code !== PRODUCT.currency || amount?.value !== PRODUCT.price) {
      return res.status(409).json({ error: "Payment is not confirmed as completed for the expected product and amount." });
    }

    const token = signToken({
      productId: PRODUCT.id,
      orderId,
      exp: Math.floor(Date.now() / 1000) + 15 * 60
    });
    res.set("Cache-Control", "no-store");
    res.json({ status: "COMPLETED", downloadUrl: `/download/${encodeURIComponent(token)}` });
  } catch (e) {
    console.error("Capture failed:", e.message);
    res.status(502).json({ error: "Payment could not be confirmed. Check your PayPal activity before attempting another payment." });
  }
});

app.get("/download/:token", async (req, res) => {
  const payload = readToken(req.params.token);
  if (!payload) return res.status(403).send("This download link is invalid or expired. Contact store support for help.");
  try {
    const file = await fs.readFile(PRODUCT.file);
    res.set({
      "Content-Type": "text/html; charset=utf-8",
      "Content-Disposition": 'attachment; filename="RealityState-Hunting-Holographic.html"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    });
    return res.send(file);
  } catch {
    console.error("Paid game artifact is missing.");
    return res.status(500).send("The game download is temporarily unavailable.");
  }
});

app.post("/api/paypal/webhook", async (req, res) => {
  try {
    assertConfig();
    if (!process.env.PAYPAL_WEBHOOK_ID) return res.status(503).send("Webhook not configured.");
    const transmission = {
      auth_algo: req.get("paypal-auth-algo"),
      cert_url: req.get("paypal-cert-url"),
      transmission_id: req.get("paypal-transmission-id"),
      transmission_sig: req.get("paypal-transmission-sig"),
      transmission_time: req.get("paypal-transmission-time")
    };
    if (Object.values(transmission).some(v => !v)) return res.status(400).send("Missing webhook signature headers.");
    const verified = await paypalRequest("/v1/notifications/verify-webhook-signature", {
      method: "POST",
      body: JSON.stringify({ ...transmission, webhook_id: process.env.PAYPAL_WEBHOOK_ID, webhook_event: req.body })
    });
    if (verified.verification_status !== "SUCCESS") return res.status(400).send("Webhook signature verification failed.");
    console.info("Verified PayPal event:", req.body?.event_type || "UNKNOWN");
    // Before production, persist event IDs and reconcile captures/refunds in a database.
    return res.sendStatus(200);
  } catch (e) {
    console.error("Webhook verification error:", e.message);
    return res.status(500).send("Webhook verification temporarily unavailable.");
  }
});

app.get("/health", (_req, res) => res.json({ ok: true, service: "realitystateos-hunting-store" }));
app.listen(PORT, () => console.log(`RealityStateOS Hunting store listening on ${PORT}; PayPal ${LIVE ? "LIVE" : "SANDBOX"} mode.`));
