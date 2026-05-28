#!/usr/bin/env node
// vibe-o-matic — headless x402 agent runner
// ─────────────────────────────────────────────
// One command for an autonomous AI agent to: discover → pay → render →
// settle a Vibetown vinyl-figurine render of any photo. Real USDC moves
// on Base mainnet ($0.69 per call). Result PNG saved to disk.
//
// Usage:
//   node scripts/test-x402-agent.mjs [options] [<intent>]
//
// Options:
//   --image, -i <path>      Photo to render. Default: searches for
//                           ./agent-photo.{jpg,jpeg,png,webp} in cwd.
//   --key-file, -k <path>   Plaintext file holding the private key as
//                           hex (with or without 0x prefix). Simplest
//                           form, falls back to AGENT_PRIVATE_KEY env.
//   --credential-path <p>   Read the key from a structured credentials
//                           file (JSON). Pairs with the two flags below.
//   --credential-format <f> Format of --credential-path. Currently only
//                           "json" is supported; that's the default.
//   --credential-key <k>    Field in the JSON to read. Defaults to
//                           "privateKey". Pass a different name for
//                           stores that use a different schema.
//   --target, -t <url>      Override deployment URL.
//                           Default: $TARGET or https://vibe-o-matic.vercel.app
//   --no-balance-check      Skip the on-chain USDC balance preflight.
//   --help, -h              Print this message.
//
// Environment:
//   AGENT_PRIVATE_KEY       Base mainnet wallet key (0x prefix optional).
//   TARGET                  Endpoint base URL (e.g. http://localhost:3000).
//
// Examples:
//   node scripts/test-x402-agent.mjs "cosmic vibes at a space station"
//   AGENT_PRIVATE_KEY=abc...  node scripts/test-x402-agent.mjs "rockstars"
//   node scripts/test-x402-agent.mjs -k ~/.x402-key -i ./me.jpg "chill day"
//
// Reading from a JSON credentials store (no jq, no temp files):
//   node scripts/test-x402-agent.mjs \
//     --credential-path ~/.openclaw/credentials/base-default.json \
//     --image ~/.openclaw/media/inbound/portrait.jpg \
//     "rockstars at an after-party"
//
// If the JSON file uses a different field name for the key:
//   node scripts/test-x402-agent.mjs \
//     --credential-path ~/.your-store/creds.json \
//     --credential-key key \
//     "intent"

import { existsSync, readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

// ── Pre-flight: detect missing dependencies before we try to use them ──
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
if (!existsSync(join(repoRoot, "node_modules", "viem"))) {
  console.error("✗ Missing dependencies. From the repo root, run:");
  console.error("    npm install");
  console.error("  then re-run this script.");
  process.exit(1);
}

// ── Late imports: only after node_modules is verified ────────────────
const { createWalletClient, createPublicClient, http, parseAbi, formatUnits } =
  await import("viem");
const { base } = await import("viem/chains");
const { privateKeyToAccount } = await import("viem/accounts");
const { wrapFetchWithPayment } = await import("x402-fetch");

// ── Args ──────────────────────────────────────────────────────────────
let parsed;
try {
  parsed = parseArgs({
    options: {
      image: { type: "string", short: "i" },
      "key-file": { type: "string", short: "k" },
      "credential-path": { type: "string" },
      "credential-format": { type: "string" },
      "credential-key": { type: "string" },
      target: { type: "string", short: "t" },
      "no-balance-check": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });
} catch (e) {
  console.error(`✗ Argument parse error: ${e.message}`);
  process.exit(1);
}

if (parsed.values.help) {
  // Re-print the header docstring for `--help`.
  console.error(
    readFileSync(fileURLToPath(import.meta.url), "utf8")
      .split("\n")
      .filter((l, i, arr) => l.startsWith("//") || (i > 0 && arr[i - 1].startsWith("//")))
      .slice(0, 36)
      .map((l) => l.replace(/^\/\/ ?/, ""))
      .join("\n")
  );
  process.exit(0);
}

const intent = parsed.positionals.join(" ").trim();
const TARGET =
  parsed.values.target || process.env.TARGET || "https://vibe-o-matic.vercel.app";
const ENDPOINT = `${TARGET}/api/vibeify/x402`;

// ── Resolve the image path: explicit flag, then default search ───────
function resolveImagePath() {
  if (parsed.values.image) {
    const p = resolve(parsed.values.image);
    if (!existsSync(p)) {
      console.error(`✗ Image not found at --image path: ${p}`);
      process.exit(1);
    }
    return p;
  }
  // Default convention: look for agent-photo.{ext} in cwd.
  for (const ext of ["jpg", "jpeg", "png", "webp"]) {
    const candidate = resolve(`./agent-photo.${ext}`);
    if (existsSync(candidate)) return candidate;
  }
  console.error("✗ No image specified and no default photo found.");
  console.error();
  console.error("  Either:");
  console.error("    • Drop a portrait at ./agent-photo.jpg (or .png/.jpeg/.webp), or");
  console.error("    • Pass --image <path-to-your-photo>");
  console.error();
  console.error("  GVC logos and other non-portrait images can trip the");
  console.error("  gpt-4o-mini describer — use a real photo of a person.");
  process.exit(1);
}
const imagePath = resolveImagePath();

// ── Resolve the private key ──────────────────────────────────────────
// Priority: --credential-path (structured) > --key-file (plaintext) >
// AGENT_PRIVATE_KEY env. Each path normalizes (trim + optional 0x) and
// validates the 64-hex-char shape before returning.
function readFromCredentialFile() {
  const p = resolve(parsed.values["credential-path"]);
  if (!existsSync(p)) {
    console.error(`✗ --credential-path not found: ${p}`);
    process.exit(1);
  }
  const fmt = parsed.values["credential-format"] || "json";
  const fieldKey = parsed.values["credential-key"] || "privateKey";
  if (fmt !== "json") {
    console.error(
      `✗ --credential-format "${fmt}" not supported. Only "json" is currently supported.`
    );
    console.error(`  For plaintext key files, use --key-file <path> instead.`);
    process.exit(1);
  }
  let payload;
  try {
    payload = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    console.error(`✗ Could not parse ${p} as JSON: ${e.message}`);
    process.exit(1);
  }
  const value = payload?.[fieldKey];
  if (typeof value !== "string") {
    console.error(`✗ JSON field "${fieldKey}" missing or not a string in ${p}.`);
    if (payload && typeof payload === "object") {
      console.error(`  Available top-level fields: ${Object.keys(payload).join(", ")}`);
    }
    console.error(`  Override the field name with --credential-key <name>.`);
    process.exit(1);
  }
  return value;
}

function resolvePrivateKey() {
  let raw;
  if (parsed.values["credential-path"]) {
    raw = readFromCredentialFile();
  } else if (parsed.values["key-file"]) {
    const p = resolve(parsed.values["key-file"]);
    if (!existsSync(p)) {
      console.error(`✗ --key-file not found: ${p}`);
      process.exit(1);
    }
    raw = readFileSync(p, "utf8");
  } else if (process.env.AGENT_PRIVATE_KEY) {
    raw = process.env.AGENT_PRIVATE_KEY;
  } else {
    console.error("✗ No private key supplied. Three ways to provide one:");
    console.error();
    console.error("  • --credential-path <path>     read from a JSON credentials store");
    console.error("                                 (e.g. ~/.openclaw/credentials/base-default.json)");
    console.error("                                 + optional --credential-key <field> (default: privateKey)");
    console.error("  • --key-file <path>            read from a plaintext file holding just the key");
    console.error("  • AGENT_PRIVATE_KEY=0x... env  set in shell env (avoid for autonomous use)");
    console.error();
    console.error("  Key must control a Base mainnet wallet with ≥$0.69 USDC.");
    process.exit(1);
  }
  // Normalize: trim whitespace + optional 0x prefix
  raw = raw.trim();
  if (!raw.startsWith("0x")) raw = "0x" + raw;
  if (!/^0x[0-9a-fA-F]{64}$/.test(raw)) {
    console.error(`✗ Private key doesn't look right (expected 64 hex chars, got ${raw.length - 2}).`);
    process.exit(1);
  }
  return raw;
}
const PRIVATE_KEY = resolvePrivateKey();

// ── Build account + clients ──────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const wallet = createWalletClient({
  account,
  chain: base,
  transport: http(),
});
const publicClient = createPublicClient({
  chain: base,
  transport: http(),
});

// Per-call spend cap = 1 USDC (6 decimals). Hard refusal if the server
// ever quotes more, regardless of how the user signs.
const fetchWithPay = wrapFetchWithPayment(fetch, wallet, 1_000_000n);

console.log(`▸ Wallet:    ${account.address}`);
console.log(`▸ Endpoint:  ${ENDPOINT}`);
console.log(`▸ Image:     ${imagePath}`);
console.log(`▸ Intent:    ${intent || "(none — agent decides from photo only)"}`);
console.log();

// ── Pre-flight: on-chain USDC balance check (fail fast) ─────────────
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PRICE_ATOMIC = 690_000n; // $0.69 in 6-decimal atomic units
if (!parsed.values["no-balance-check"]) {
  try {
    const balance = await publicClient.readContract({
      address: USDC_BASE,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [account.address],
    });
    const balanceUsdc = Number(balance) / 1_000_000;
    console.log(`▸ USDC bal:  $${balanceUsdc.toFixed(4)} (Base mainnet)`);
    if (balance < PRICE_ATOMIC) {
      console.error();
      console.error(`✗ Insufficient USDC. Need ≥$0.69 to cover this render.`);
      console.error(`  Acquire USDC on Base mainnet via any major bridge or DEX,`);
      console.error(`  then re-run. Skip this check with --no-balance-check.`);
      process.exit(1);
    }
    console.log();
  } catch (e) {
    console.warn(
      `  (balance preflight failed — continuing anyway: ${e.shortMessage || e.message})`
    );
    console.log();
  }
}

// ── Discovery (no payment) — lets the caller see the price quote ────
try {
  const disco = await fetch(ENDPOINT);
  const meta = await disco.json();
  console.log("▸ Discovery:", meta);
  console.log();
} catch (e) {
  console.warn(`  (discovery GET failed — continuing: ${e.message})`);
}

// ── Build the multipart form ────────────────────────────────────────
const imgBuf = await readFile(imagePath);
const ext = extname(imagePath).slice(1).toLowerCase() || "png";
const mime =
  ext === "jpg" || ext === "jpeg"
    ? "image/jpeg"
    : ext === "webp"
    ? "image/webp"
    : "image/png";

const form = new FormData();
form.set(
  "image",
  new File([new Uint8Array(imgBuf)], basename(imagePath), { type: mime })
);
form.set("agentMode", "1");
if (intent) form.set("intent", intent);

// ── The big one: POST with x402 payment handshake ───────────────────
console.log("▸ POSTing with x402 payment handshake…");
const t0 = Date.now();
let res;
try {
  res = await fetchWithPay(ENDPOINT, { method: "POST", body: form });
} catch (e) {
  console.error(`\n✗ Network / payment error: ${e.message}`);
  process.exit(1);
}

const elapsedSec = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`▸ Response in ${elapsedSec}s — HTTP ${res.status}`);
console.log();

const data = await res.json();
if (!res.ok) {
  console.error(`✗ Render failed: ${data.error || JSON.stringify(data)}`);
  process.exit(1);
}

// ── Print agent picks if the server ran in agent mode ───────────────
if (data.agentPicks) {
  console.log("🤖 Agent picks:");
  console.log(`   scene:     ${data.agentPicks.sceneId}`);
  console.log(`   action:    ${data.agentPicks.actionId}`);
  console.log(`   mood:      ${data.agentPicks.moodId}`);
  console.log(`   size:      ${data.agentPicks.size}`);
  console.log(`   reasoning: ${data.agentPicks.reasoning}`);
  console.log();
}

// ── Settlement receipt from the X-PAYMENT-RESPONSE header ───────────
const paymentResponseHeader = res.headers.get("X-PAYMENT-RESPONSE");
if (paymentResponseHeader) {
  try {
    const settlement = JSON.parse(
      Buffer.from(paymentResponseHeader, "base64").toString("utf8")
    );
    console.log("💸 Settlement:", settlement);
    if (settlement.transaction) {
      console.log(`   → https://basescan.org/tx/${settlement.transaction}`);
    }
    console.log();
  } catch {
    /* shrug */
  }
}

// ── Save the image ────────────────────────────────────────────────
if (typeof data.image === "string" && data.image.startsWith("data:")) {
  const b64 = data.image.split(",")[1];
  const outBuf = Buffer.from(b64, "base64");
  const outPath = resolve(`./x402-agent-out-${Date.now()}.png`);
  await writeFile(outPath, outBuf);
  console.log(
    `✓ Image saved: ${outPath}  (${(outBuf.length / 1024).toFixed(0)} KB)`
  );
} else {
  console.warn("(no image data in response)");
}

// ── Optional: describer output for transparency ─────────────────────
if (data.description) {
  console.log();
  console.log(`▸ Describer output (${data.description.length} chars):`);
  console.log(data.description.split("\n").map((l) => "  " + l).join("\n"));
}
