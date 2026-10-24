# RealityStateOS Hunting — Holographic Premium Bundle

This project packages the existing `realitystatehunting_holographic_upgrade.html` game as a paid digital product and provides a RealityStateOS storefront with PayPal Checkout.

**Product price:** $4.99 USD one-time  
**Delivery:** Download link created only after the server confirms a completed PayPal capture for the expected product, amount, and currency.

## Included

- `private/product/RealityState-Hunting-Holographic.html`: original hunting-game HTML preserved as the paid artifact.
- `public/`: commercial product page, styles, and PayPal client checkout.
- `server.js`: server-side order creation/capture, validation, short-lived signed download links, webhook signature verification endpoint.
- `private/product-bundle/`: included separately in the project archive with a product guide and launch checklist.
- `.env.example`: safe template for environment variables.

## Requirements

- Node.js 20 or later
- PayPal Developer account for sandbox testing
- PayPal Business account and live REST app for live sales
- A Node-capable HTTPS host for public launch

## Run locally

```bash
cp .env.example .env
npm install
openssl rand -hex 32
```

Paste the generated secret into `DOWNLOAD_TOKEN_SECRET` in `.env`. Add your PayPal sandbox app client ID and secret. Never commit `.env`, share the secret, or place the PayPal client secret in browser code.

```bash
npm run dev
```

Open `http://localhost:3000`. Without valid sandbox credentials, checkout remains unavailable by design.

## PayPal setup

1. Visit https://developer.paypal.com/dashboard/
2. Open Apps & Credentials and create/select a REST app in **Sandbox**.
3. Copy the sandbox client ID and secret to `.env`.
4. Use PayPal's sandbox buyer and seller accounts to test. Sandbox funds are simulated, not real money.
5. For webhook monitoring, register `https://YOUR-DOMAIN/api/paypal/webhook` in the PayPal app and save its webhook ID as `PAYPAL_WEBHOOK_ID`. Subscribe to relevant order/capture events, including `CHECKOUT.ORDER.APPROVED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, and `PAYMENT.CAPTURE.REFUNDED`.
6. Deploy to a host with HTTPS. Configure secrets in the host's environment-variable dashboard, set `BASE_URL` to your final HTTPS domain, and run in sandbox.
7. After tests pass, switch to `PAYPAL_ENV=live` and use live app credentials. Ensure your PayPal merchant account is the intended receiving account before enabling sales.

Official PayPal documentation:
- https://developer.paypal.com/api/get-started/
- https://developer.paypal.com/api/rest/authentication/
- https://developer.paypal.com/studio/checkout/standard/getstarted
- https://developer.paypal.com/sandbox-testing/overview/

## Test checklist

- [ ] Product price is $4.99 USD and set server-side.
- [ ] Approved sandbox order is captured by the server.
- [ ] Download unlocks only for `COMPLETED` capture, expected product ID, exact amount, and USD currency.
- [ ] Cancelled and failed payments do not issue a download link.
- [ ] Token expiry and tampering are rejected.
- [ ] Secret values are never served to the browser.
- [ ] Test mobile and desktop game behavior, including CDN access.
- [ ] Add real support email, privacy notice, terms, refund policy, and any applicable tax disclosures before live launch.

## Production hardening required

This is a runnable MVP, not a fully managed commerce system. Before relying on it for real sales, add:
- A durable order database and unique order/event records.
- Idempotent capture/fulfillment handling and delivery recovery if the buyer closes the browser.
- A persistent ledger that reconciles gross sales, PayPal fees, refunds, disputes, and actual deposits.
- Admin tooling, alerts, backups, rate limiting, and monitored support.
- A refund workflow and verified webhook processing for relevant event types.

The webhook endpoint verifies PayPal's signature and logs verified events, but it does not yet persist them or initiate refunds. The current delivery link expires after 15 minutes and is signed; it is not a one-time token and may be reused during that window. Consider a database-backed, single-use download token before a wider commercial launch.

## Game notes

The game source is preserved as supplied. It loads Three.js from a CDN, so a connection is required for the library to load. Review ownership/licensing of the source and any third-party assets, test on supported devices, and provide accurate compatibility information to customers.
