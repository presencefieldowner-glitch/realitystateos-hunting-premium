const statusEl = document.getElementById("status");
function setStatus(message, error = false) {
  statusEl.textContent = message;
  statusEl.style.color = error ? "#ffb4b4" : "#b6e58c";
}
async function initCheckout() {
  try {
    const cfgResponse = await fetch("/api/config", { cache: "no-store" });
    const cfg = await cfgResponse.json();
    if (!cfgResponse.ok || !cfg.clientId || cfg.clientId.startsWith("replace_")) {
      throw new Error("Store owner setup is incomplete. PayPal checkout is not yet available.");
    }
    const sdk = new URL("https://www.paypal.com/sdk/js");
    sdk.searchParams.set("client-id", cfg.clientId);
    sdk.searchParams.set("currency", cfg.currency);
    sdk.searchParams.set("intent", "capture");
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = sdk.toString();
      script.onload = resolve;
      script.onerror = () => reject(new Error("PayPal checkout could not load. Check your connection and try again."));
      document.head.appendChild(script);
    });
    window.paypal.Buttons({
      style: { layout: "vertical", shape: "rect", label: "paypal", tagline: false },
      createOrder: async () => {
        setStatus("Creating your PayPal order…");
        const r = await fetch("/api/orders", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
        const data = await r.json();
        if (!r.ok || !data.id) throw new Error(data.error || "Could not start checkout.");
        return data.id;
      },
      onApprove: async (data) => {
        setStatus("Verifying completed payment…");
        const r = await fetch(`/api/orders/${encodeURIComponent(data.orderID)}/capture`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
        });
        const result = await r.json();
        if (!r.ok || result.status !== "COMPLETED" || !result.downloadUrl) {
          throw new Error(result.error || "Payment has not been confirmed. Check PayPal activity or contact support before paying again.");
        }
        setStatus("Payment verified. Preparing your game download…");
        window.location.assign(result.downloadUrl);
      },
      onCancel: () => setStatus("Checkout cancelled. No completed payment was recorded."),
      onError: () => {
        setStatus("Checkout error. Please try again or contact store support.", true);
      }
    }).render("#paypal-buttons");
    setStatus(`PayPal checkout ready (${cfg.environment}).`);
  } catch (e) {
    setStatus(e.message || "Checkout is temporarily unavailable.", true);
  }
}
initCheckout();
