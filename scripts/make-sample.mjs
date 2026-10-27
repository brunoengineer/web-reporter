/**
 * Builds a realistic sample report so the viewer can be designed and debugged in a plain
 * browser tab — no extension needed.
 *
 *   npm run sample            -> sample/report.html
 *   npm run sample -- --dark  -> forces dark theme
 *
 * Requires src/report/_bundle.ts (run `npm run build:viewer` first; `presample` does it).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "sample");
mkdirSync(outDir, { recursive: true });

const dark = process.argv.includes("--dark");
const outFile = resolve(outDir, dark ? "report-dark.html" : "report.html");

// _bundle.ts is TypeScript only by its two `: string` annotations; strip them and import.
const bundleTs = readFileSync(resolve(root, "src/report/_bundle.ts"), "utf8");
const tmp = resolve(outDir, "_bundle.tmp.mjs");
writeFileSync(tmp, bundleTs.replace(/: string =/g, " ="));
const { VIEWER_JS, VIEWER_CSS } = await import(pathToFileURL(tmp).href);

// ---------------------------------------------------------------- fake data

const T0 = Date.parse("2026-10-27T09:41:12.000Z");
let t = T0;
const at = (deltaMs) => (t += deltaMs);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const page = (url, title) => ({
  type: "page",
  ts: at(80),
  url,
  title,
  userAgent: UA,
  viewport: { w: 1440, h: 860 },
  screen: { w: 2560, h: 1440 },
  dpr: 1.5,
  language: "en-GB",
  timezone: "Europe/Stockholm",
  platform: "Win32",
  online: true,
});

const net = (method, path, status, duration, extra = {}) => ({
  type: "network",
  ts: at(duration + 40),
  method,
  url: `https://api.shop.example${path}`,
  status,
  statusText: { 200: "OK", 201: "Created", 304: "Not Modified", 401: "Unauthorized", 404: "Not Found", 500: "Internal Server Error", 0: "" }[status] ?? "",
  duration,
  size: status === 0 ? undefined : 180 + Math.round(Math.random() * 4000),
  initiator: Math.random() > 0.5 ? "fetch" : "xhr",
  requestHeaders: { accept: "application/json", authorization: "[REDACTED]", "x-request-id": `req_${Math.random().toString(36).slice(2, 10)}` },
  responseHeaders: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-trace-id": "4d2a-9f1c" },
  responseContentType: "application/json; charset=utf-8",
  ...extra,
});

const svgShot = (label, hue) =>
  "data:image/svg+xml;base64," +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1440" height="860">
      <rect width="100%" height="100%" fill="hsl(${hue} 30% 96%)"/>
      <rect x="0" y="0" width="100%" height="56" fill="hsl(${hue} 60% 40%)"/>
      <rect x="40" y="120" width="560" height="38" rx="6" fill="#fff" stroke="#cbd5e1"/>
      <rect x="40" y="180" width="560" height="38" rx="6" fill="#fff" stroke="#cbd5e1"/>
      <rect x="40" y="250" width="180" height="40" rx="8" fill="hsl(${hue} 60% 40%)"/>
      <text x="48" y="36" font-family="system-ui" font-size="20" fill="#fff">shop.example</text>
      <text x="720" y="440" font-family="system-ui" font-size="28" fill="#334155">${label}</text>
    </svg>`,
  ).toString("base64");

const events = [
  page("https://shop.example/checkout", "Checkout — shop.example"),
  { type: "console", ts: at(20), level: "info", message: "[app] boot v4.12.1 (prod)" },
  { type: "console", ts: at(5), level: "debug", message: '{"feature":"new-checkout","enabled":true,"cohort":"B"}' },
  net("GET", "/api/cart", 200, 182),
  net("GET", "/api/me", 200, 96),
  { type: "console", ts: at(10), level: "warn", message: "Deprecated: CartStore.subscribe will be removed in v5. Use useCart() instead." },
  { type: "click", ts: at(1800), selector: "#email", tag: "INPUT" },
  { type: "input", ts: at(1400), selector: "#email", inputType: "email", length: 12, redacted: false },
  { type: "input", ts: at(900), selector: "#email", inputType: "email", length: 21, redacted: false },
  { type: "key", ts: at(300), key: "Tab", selector: "#email" },
  { type: "input", ts: at(2600), selector: "#card-number", inputType: "text", length: 0, redacted: true },
  { type: "input", ts: at(1500), selector: "#cvv", inputType: "text", length: 0, redacted: true },
  { type: "click", ts: at(1200), selector: "form#payment > button.btn-primary", tag: "BUTTON", text: "Pay €49.00" },
  { type: "submit", ts: at(12), selector: "form#payment" },
  net("POST", "/api/payments", 500, 1340, {
    requestContentType: "application/json",
    requestBody: '{"amount":4900,"currency":"EUR","method":"card","idempotencyKey":"c1c0e1b3"}',
    responseBody: '{"error":"PaymentProviderError","message":"upstream timeout after 1200ms","traceId":"4d2a-9f1c"}',
  }),
  { type: "console", ts: at(15), level: "error", message: "PaymentProviderError: upstream timeout after 1200ms (traceId 4d2a-9f1c)" },
  {
    type: "error",
    ts: at(8),
    message: "Uncaught TypeError: Cannot read properties of undefined (reading 'receiptUrl')",
    stack:
      "TypeError: Cannot read properties of undefined (reading 'receiptUrl')\n    at onPaymentSettled (https://shop.example/assets/checkout.9f3a2c.js:1:48213)\n    at async submitPayment (https://shop.example/assets/checkout.9f3a2c.js:1:47102)",
    source: "https://shop.example/assets/checkout.9f3a2c.js:1:48213",
  },
  { type: "console", ts: at(400), level: "error", message: "Failed to render receipt: receipt is undefined" },
  { type: "console", ts: at(120), level: "error", message: "Failed to render receipt: receipt is undefined" },
  { type: "console", ts: at(120), level: "error", message: "Failed to render receipt: receipt is undefined" },
  { type: "screenshot", ts: at(2200), id: "shot-1", kind: "manual", url: "https://shop.example/checkout", title: "Checkout — shop.example" },
  { type: "note", ts: at(6000), text: "Spinner on the Pay button never stops. No error toast is shown to the user." },
  { type: "click", ts: at(2500), selector: "form#payment > button.btn-primary", tag: "BUTTON", text: "Pay €49.00" },
  { type: "submit", ts: at(10), selector: "form#payment" },
  net("POST", "/api/payments", 500, 1210, {
    requestContentType: "application/json",
    requestBody: '{"amount":4900,"currency":"EUR","method":"card","idempotencyKey":"c1c0e1b3"}',
    responseBody: '{"error":"PaymentProviderError","message":"upstream timeout after 1200ms","traceId":"7b81-02ee"}',
  }),
  { type: "console", ts: at(12), level: "error", message: "PaymentProviderError: upstream timeout after 1200ms (traceId 7b81-02ee)" },
  net("GET", "/api/orders/latest", 404, 88),
  { type: "console", ts: at(5), level: "warn", message: "No order found after payment attempt; falling back to cart" },
  { type: "key", ts: at(3000), key: "Escape", selector: "div.modal" },
  { type: "click", ts: at(1500), selector: "nav > a.orders-link", tag: "A", text: "My orders", href: "https://shop.example/orders" },
  { type: "nav", ts: at(40), url: "https://shop.example/orders", kind: "pushstate" },
  net("GET", "/api/orders?limit=20", 200, 240),
  net("GET", "/api/orders/latest", 304, 32),
  { type: "console", ts: at(10), level: "log", message: "orders: 0 results" },
  { type: "screenshot", ts: at(1800), id: "shot-2", kind: "manual", url: "https://shop.example/orders", title: "Orders — shop.example" },
  { type: "note", ts: at(2500), text: "Expected to see the failed order with a retry CTA. Orders list is empty." },
  { type: "key", ts: at(2000), key: "Ctrl+R", selector: "body" },
  page("https://shop.example/orders", "Orders — shop.example"),
  net("GET", "/api/orders?limit=20", 0, 15, { error: "Failed to fetch", responseHeaders: undefined, responseContentType: undefined }),
  { type: "console", ts: at(30), level: "error", message: "TypeError: Failed to fetch" },
  { type: "error", ts: at(5), message: "Unhandled rejection: TypeError: Failed to fetch", stack: "TypeError: Failed to fetch\n    at loadOrders (orders.js:12:9)" },
  net("GET", "/api/orders?limit=20", 200, 310),
  { type: "console", ts: at(10), level: "log", message: "orders: 0 results" },
  { type: "screenshot", ts: at(900), id: "shot-3", kind: "manual", url: "https://shop.example/orders", title: "Orders — shop.example" },
];

const meta = {
  id: "c2b2f0d4-0000-4000-8000-000000000001",
  state: "idle",
  startedAt: T0,
  title: "Payment fails with 500 and the order never appears",
  severity: "high",
  notes:
    "Preconditions: logged-in test user (qa+checkout@example.com), one item in cart.\n\nExpected: payment succeeds, redirect to receipt page.\nActual: spinner never stops, no feedback, and /orders stays empty even after a reload.\n\nReproduces 3/3 on staging. Not reproducible on prod.",
  tab: { id: 42, windowId: 1, url: "https://shop.example/checkout", title: "Checkout — shop.example" },
  appVersion: "0.2.0",
};

const screenshots = {
  "shot-1": svgShot("Pay button spinner (stuck)", 200),
  "shot-2": svgShot("Orders list — empty", 150),
  "shot-3": svgShot("Orders list after reload — still empty", 20),
};

const endedAt = t + 1500;

const escapeJson = (s) => s.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "\\u003c!--");

const html = `<!doctype html>
<html lang="en"${dark ? ' data-theme="dark"' : ""}>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${meta.title}</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<div id="app"></div>
<script id="wr-session" type="application/json">${escapeJson(JSON.stringify({ meta, events, endedAt }))}</script>
<script id="wr-screenshots" type="application/json">${escapeJson(JSON.stringify(screenshots))}</script>
<script>${VIEWER_JS}</script>
</body>
</html>`;

writeFileSync(outFile, html);
try {
  const { unlinkSync } = await import("node:fs");
  unlinkSync(tmp);
} catch {
  /* ignore */
}
console.log(`[make-sample] wrote ${outFile} (${(html.length / 1024).toFixed(0)} KB, ${events.length} events)`);
