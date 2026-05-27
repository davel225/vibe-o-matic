#!/usr/bin/env node
// End-to-end smoke test for /api/vibeify/x402 in agent mode.
//
// Flow:
//   1. Read AGENT_PRIVATE_KEY from env (a Base MAINNET private key with at
//      least $0.69 USDC — this is the live production endpoint, real money).
//   2. Wrap fetch with x402-fetch so the two-step 402 → pay → retry handshake
//      is transparent.
//   3. POST a multipart form with the image + agentMode=1 + optional intent.
//   4. Save the rendered image to disk, print agentPicks.
//
// Usage:
//   AGENT_PRIVATE_KEY=0x... node scripts/test-x402-agent.mjs <image-path> [intent text...]
//
// Example:
//   AGENT_PRIVATE_KEY=0xabc... node scripts/test-x402-agent.mjs ./me.jpg "rockstars at an after-party"
//
// If the target server isn't localhost:3000, set:
//   TARGET=https://your-host node scripts/test-x402-agent.mjs ...

import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createWalletClient, http } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { wrapFetchWithPayment } from "x402-fetch";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ────────────────────────────────────────────────────
const TARGET = process.env.TARGET || "http://localhost:3000";
const ENDPOINT = `${TARGET}/api/vibeify/x402`;
const PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY;
const args = process.argv.slice(2);
const imagePath = args[0];
const intent = args.slice(1).join(" ");

if (!PRIVATE_KEY) {
  console.error(
    "ERROR: set AGENT_PRIVATE_KEY=0x... in env (Base mainnet wallet with ≥$0.69 USDC)."
  );
  console.error("Acquire USDC on Base mainnet via any major bridge or DEX.");
  process.exit(1);
}
if (!imagePath) {
  console.error("Usage: AGENT_PRIVATE_KEY=0x... node scripts/test-x402-agent.mjs <image-path> [intent]");
  process.exit(1);
}

// ── Build payment-wrapped fetcher ─────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const wallet = createWalletClient({
  account,
  chain: base,
  transport: http(),
});
// Per-call spend cap in atomic USDC units (6 decimals).
// 1_000_000 = 1.00 USDC — comfortable headroom over our $0.69 quote.
// x402-fetch's default cap is low (~0.10), which rejects our quoted price.
const fetchWithPay = wrapFetchWithPayment(fetch, wallet, 1_000_000n);

console.log(`▸ Wallet:    ${account.address}`);
console.log(`▸ Endpoint:  ${ENDPOINT}`);
console.log(`▸ Image:     ${imagePath}`);
console.log(`▸ Intent:    ${intent || "(none — agent decides from photo only)"}`);
console.log();

// ── Discovery (no payment) ────────────────────────────────────
try {
  const disco = await fetch(ENDPOINT);
  const meta = await disco.json();
  console.log("▸ Discovery:", meta);
  console.log();
} catch (e) {
  console.warn(`  (discovery GET failed — continuing: ${e.message})`);
}

// ── Build the form ────────────────────────────────────────────
const imgBuf = await readFile(resolve(imagePath));
const ext = extname(imagePath).slice(1).toLowerCase() || "png";
const mime =
  ext === "jpg" || ext === "jpeg"
    ? "image/jpeg"
    : ext === "webp"
    ? "image/webp"
    : "image/png";

const form = new FormData();
form.set("image", new Blob([imgBuf], { type: mime }), basename(imagePath));
form.set("agentMode", "1");
if (intent) form.set("intent", intent);

// ── Fire the request ──────────────────────────────────────────
const t0 = Date.now();
console.log("▸ POSTing with x402 payment handshake…");
let res;
try {
  res = await fetchWithPay(ENDPOINT, { method: "POST", body: form });
} catch (e) {
  console.error(`\n✗ Network / payment error: ${e.message}`);
  process.exit(1);
}
const elapsedMs = Date.now() - t0;

const data = await res.json().catch(() => ({}));
console.log(`▸ Response in ${(elapsedMs / 1000).toFixed(1)}s — HTTP ${res.status}`);
console.log();

if (!res.ok) {
  console.error("✗ Render failed:");
  console.error(data);
  process.exit(1);
}

// ── Show what the agent picked ────────────────────────────────
if (data.agentPicks) {
  console.log("🤖 Agent picks:");
  console.log(`   scene:     ${data.agentPicks.sceneId}`);
  console.log(`   action:    ${data.agentPicks.actionId}`);
  console.log(`   mood:      ${data.agentPicks.moodId}`);
  console.log(`   size:      ${data.agentPicks.size}`);
  console.log(`   reasoning: ${data.agentPicks.reasoning}`);
  console.log();
} else {
  console.log("(no agentPicks in response — was agentMode=1 sent?)");
}

// ── Show what the payment did ─────────────────────────────────
const payRespHeader = res.headers.get("X-PAYMENT-RESPONSE");
if (payRespHeader) {
  try {
    const decoded = JSON.parse(Buffer.from(payRespHeader, "base64").toString("utf8"));
    console.log("💸 Settlement:", decoded);
    console.log();
  } catch {
    /* ignore decode errors */
  }
}

// ── Save the image ────────────────────────────────────────────
if (typeof data.image === "string" && data.image.startsWith("data:")) {
  const b64 = data.image.split(",")[1];
  const outBuf = Buffer.from(b64, "base64");
  const outPath = resolve(
    __dirname,
    `../x402-agent-out-${Date.now()}.png`
  );
  await writeFile(outPath, outBuf);
  console.log(`✓ Image saved: ${outPath}  (${(outBuf.length / 1024).toFixed(0)} KB)`);
} else {
  console.warn("(no image data in response)");
}

// ── Show what the renderer produced for the prompt ────────────
if (data.description) {
  console.log();
  console.log(`▸ Describer output (${data.description.length} chars):`);
  console.log(data.description.split("\n").map((l) => "  " + l).join("\n"));
}
