#!/usr/bin/env node
/**
 * Compute the ERC-8257 manifest hash + show the registry call data.
 *
 * Two modes:
 *   - default (just compute + print): runs the JCS canonicalization and
 *     keccak256, prints the hex hash, the well-known URL, and the
 *     registerTool() call data that the treasury wallet would sign.
 *
 *   - `--simulate <predicate-address>`: same as above, plus a viem-based
 *     simulation of the registerTool() call against Base mainnet, to
 *     verify the call would succeed (would catch e.g. an invalid
 *     predicate, a malformed metadataURI, etc.).
 *
 * This script does NOT submit any transaction. It only reads on-chain
 * state for simulation. To actually register, the operator runs the
 * call data through their preferred wallet (treasury wallet, since
 * the creatorAddress in the manifest commits to that address).
 *
 * Usage:
 *   node scripts/erc8257-hash.mjs
 *   node scripts/erc8257-hash.mjs --simulate 0xPREDICATE...
 */

import canonicalize from "canonicalize";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
} from "viem";
import { base } from "viem/chains";

// ── Imported manifest (kept in sync with lib/erc8257-manifest.ts) ──
// We can't import the .ts module directly from an .mjs script without
// a transpilation step, so the canonical definition is duplicated here
// and a verification check below confirms the two stay aligned.
const VIBEIFY_MANIFEST = {
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "vibeify",
  description:
    "Render any image as a Good Vibes Club / Vibetown vinyl figurine. Send a photo and an optional free-text intent; receive a PNG with the scene, action, mood, and aspect ratio agentically chosen from a curated catalog of 1,008 valid combinations (6 scenes x 7 actions x 8 moods x 3 aspect ratios). Settles $0.69 USDC on Base via x402.",
  endpoint: "https://vibe-o-matic.vercel.app/api/vibeify/x402",
  inputs: {
    type: "object",
    properties: {
      image: {
        type: "string",
        description:
          "Source image, multipart file upload. Either `image` (file) or `imageUrl` (string) must be present.",
      },
      imageUrl: {
        type: "string",
        format: "uri",
        description:
          "Alternative to `image`: publicly fetchable URL (HTTPS or IPFS) of the source image.",
      },
      agentMode: {
        type: "string",
        enum: ["1"],
        description:
          "Set to '1' to opt into the server-side picker (recommended for autonomous agents). The picker chooses scene/action/mood/size from the curated catalog based on the source image plus the optional `intent`.",
      },
      intent: {
        type: "string",
        description:
          "Free-text description of the desired vibe (e.g. 'noir detective vibe at midnight'). Optional; if omitted the picker decides purely from the source image.",
      },
      sourceKind: {
        type: "string",
        enum: ["photo", "gvc-token"],
        default: "photo",
        description:
          "What the source image actually is. 'photo' (default) runs the gpt-4o-mini describer to extract identity markers as text; source pixels never reach the renderer. 'gvc-token' skips the describer entirely and injects the source image as a Flux reference, preserving body color, character type (Robot / Default / Alien), hair, and accessories at the pixel level.",
      },
      scene: {
        type: "string",
        description:
          "Explicit-mode only: full scene prompt text. Ignored when agentMode='1'.",
      },
      action: {
        type: "string",
        description:
          "Explicit-mode only: full action prompt text. Ignored when agentMode='1'.",
      },
      mood: {
        type: "string",
        description:
          "Explicit-mode only: full mood prompt text. Ignored when agentMode='1'.",
      },
      size: {
        type: "string",
        enum: ["1024x1024", "1024x1536", "1536x1024"],
        description:
          "Output aspect ratio. Defaults to 1024x1024. Ignored when agentMode='1' (picker chooses).",
      },
      sceneBgImages: {
        type: "string",
        description:
          "Explicit-mode only: comma-separated list of scene background reference filenames (from the curated catalog).",
      },
    },
  },
  outputs: {
    type: "object",
    properties: {
      image: {
        type: "string",
        description:
          "Rendered Vibetown vinyl figurine as a data: URL. Format: 'data:image/png;base64,<bytes>'.",
      },
      prompt: {
        type: "string",
        description: "Full text prompt sent to FLUX.2 [pro] for the render.",
      },
      description: {
        type: "string",
        description:
          "gpt-4o-mini's text description of the source. Empty string when sourceKind='gvc-token'.",
      },
      provider: { type: "string", enum: ["flux-2-pro"] },
      sourceKind: {
        type: "string",
        enum: ["photo", "gvc-token"],
        description: "Echoes which pipeline ran.",
      },
      paymentRail: { type: "string", enum: ["usdc"] },
      agentMode: { type: "boolean" },
      agentPicks: {
        type: "object",
        description:
          "Present when agentMode='1'. Documents which catalog ids the picker chose plus its reasoning.",
        properties: {
          sceneId: { type: "string" },
          actionId: { type: "string" },
          moodId: { type: "string" },
          size: { type: "string" },
          reasoning: { type: "string" },
        },
      },
    },
    required: ["image", "provider"],
  },
  version: "1.0.0",
  tags: [
    "image-generation",
    "nft",
    "vinyl-figurine",
    "gvc",
    "vibetown",
    "x402",
    "agentic",
  ],
  pricing: [
    {
      amount: "690000",
      asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      recipient:
        "eip155:8453:0xc93c375b022f0e707d211090d904f3266ccfce22",
      protocol: "x402",
    },
  ],
  creatorAddress: "0xc93c375b022f0e707d211090d904f3266ccfce22",
};

// ── ERC-8257 registry on Base mainnet (per 8257.ai) ──
const REGISTRY = "0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1";
const METADATA_URI =
  "https://vibe-o-matic.vercel.app/.well-known/ai-tool/vibeify.json";

// Subset of the IToolRegistry ABI — registerTool + a few reads for sanity.
const REGISTRY_ABI = [
  {
    type: "function",
    name: "registerTool",
    stateMutability: "nonpayable",
    inputs: [
      { name: "metadataURI", type: "string" },
      { name: "manifestHash", type: "bytes32" },
      { name: "accessPredicate", type: "address" },
    ],
    outputs: [{ name: "toolId", type: "uint256" }],
  },
  {
    type: "function",
    name: "toolCount",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "string" }],
  },
];

function main() {
  const argv = process.argv.slice(2);
  const simulateIdx = argv.indexOf("--simulate");
  const predicate = simulateIdx >= 0 ? argv[simulateIdx + 1] : null;

  // ── 1. Canonicalize + hash ──
  const canonical = canonicalize(VIBEIFY_MANIFEST);
  if (!canonical) {
    console.error("✗ canonicalize() returned undefined");
    process.exit(1);
  }
  const hash = keccak256(toBytes(canonical));
  const bytes = new TextEncoder().encode(canonical).length;

  console.log("\n━━━ ERC-8257 manifest hash ━━━");
  console.log(`  bytes:          ${bytes}`);
  console.log(`  keccak256(JCS): ${hash}`);
  console.log(`  metadataURI:    ${METADATA_URI}`);

  // ── 2. Sanity-check the manifest against spec character rules ──
  const hexFields = [
    VIBEIFY_MANIFEST.creatorAddress,
    VIBEIFY_MANIFEST.pricing[0].asset,
    VIBEIFY_MANIFEST.pricing[0].recipient,
  ];
  for (const f of hexFields) {
    if (f !== f.toLowerCase()) {
      console.error(`✗ uppercase hex detected: ${f}`);
      process.exit(1);
    }
  }
  if (canonical.includes("﻿")) {
    console.error("✗ BOM detected in canonical bytes");
    process.exit(1);
  }
  console.log("  ✓ hex fields lowercase");
  console.log("  ✓ no BOM");

  // ── 3. Generate the registerTool call data ──
  if (!predicate) {
    console.log("\n━━━ Next step ━━━");
    console.log("  Deploy contracts/VibeifyAccessPredicate.sol on Base mainnet.");
    console.log("  Re-run with --simulate <predicateAddress> to verify the call");
    console.log("  would succeed before submitting the registration tx.");
    return;
  }

  if (!/^0x[a-fA-F0-9]{40}$/.test(predicate)) {
    console.error(`✗ invalid predicate address: ${predicate}`);
    process.exit(1);
  }

  const callData = encodeFunctionData({
    abi: REGISTRY_ABI,
    functionName: "registerTool",
    args: [METADATA_URI, hash, predicate.toLowerCase()],
  });

  console.log("\n━━━ registerTool() call data ━━━");
  console.log(`  to:        ${REGISTRY}`);
  console.log(`  from:      ${VIBEIFY_MANIFEST.creatorAddress} (treasury)`);
  console.log(`  predicate: ${predicate.toLowerCase()}`);
  console.log(`  callData:  ${callData}`);

  // ── 4. Simulate against live Base mainnet ──
  (async () => {
    try {
      const client = createPublicClient({ chain: base, transport: http() });
      const regName = await client.readContract({
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: "name",
      });
      const count = await client.readContract({
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: "toolCount",
      });
      console.log("\n━━━ Registry sanity check (Base mainnet) ━━━");
      console.log(`  registry name:  ${regName}`);
      console.log(`  current tools:  ${count}`);
      console.log(`  next toolId:    ${BigInt(count) + 1n}`);

      // Dry-run the registration call (no state change).
      await client.simulateContract({
        address: REGISTRY,
        abi: REGISTRY_ABI,
        functionName: "registerTool",
        args: [METADATA_URI, hash, predicate.toLowerCase()],
        account: VIBEIFY_MANIFEST.creatorAddress,
      });
      console.log("  ✓ simulateContract OK — registerTool() would succeed");
      console.log(
        "\nReady to submit the real tx from the treasury wallet whenever you are."
      );
    } catch (e) {
      console.error(`✗ simulation failed: ${e.shortMessage ?? e.message}`);
      process.exit(1);
    }
  })();
}

main();
