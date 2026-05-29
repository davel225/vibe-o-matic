/**
 * ERC-8257 tool manifest for vibe-o-matic.
 *
 * This is the SOURCE OF TRUTH. The well-known URL route
 * (app/.well-known/ai-tool/vibeify.json/route.ts) serves the JCS-
 * canonicalized form of this object. The on-chain `manifestHash`
 * commitment is `keccak256(JCS(<this object>))` per RFC 8785.
 *
 * Spec: https://eips.ethereum.org/EIPS/eip-8257
 *
 * Critical hash-stability rules (any of these breaking will invalidate
 * the on-chain commitment and require re-registration):
 *   - All string values must be NFC-normalized (the source code below
 *     uses ASCII only, so this is trivially satisfied)
 *   - All hex strings (creatorAddress, asset/recipient hex portions)
 *     MUST be lowercase
 *   - Final response served at the well-known URL must be UTF-8 without
 *     BOM, byte-for-byte equal to the JCS canonical bytes
 *
 * To update the manifest in any way after registration:
 *   1. Edit this object
 *   2. Re-run `node scripts/erc8257-hash.mjs` to compute the new hash
 *   3. Call `updateToolMetadata(toolId, newURI, newHash)` on the registry
 *      from the treasury wallet (which owns the listing as `creator`)
 */

export const VIBEIFY_MANIFEST = {
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
      provider: {
        type: "string",
        enum: ["flux-2-pro"],
      },
      sourceKind: {
        type: "string",
        enum: ["photo", "gvc-token"],
        description: "Echoes which pipeline ran.",
      },
      paymentRail: {
        type: "string",
        enum: ["usdc"],
      },
      agentMode: {
        type: "boolean",
      },
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
      // $0.69 USDC = 690,000 atomic units (USDC has 6 decimals on Base).
      amount: "690000",
      // USDC on Base mainnet (Circle's deployment).
      asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      // Treasury wallet on Base mainnet (same address that receives x402
      // settlements today). MUST match the on-chain creator address.
      recipient:
        "eip155:8453:0xc93c375b022f0e707d211090d904f3266ccfce22",
      protocol: "x402",
    },
  ],
  // Lowercase hex per spec. Must equal `getToolConfig(toolId).creator`
  // returned by the on-chain registry after registerTool() lands.
  creatorAddress: "0xc93c375b022f0e707d211090d904f3266ccfce22",
} as const;

/**
 * Compute the well-known URL at which this manifest must be served per the
 * spec's origin-binding rules (§ 6 of ERC-8257). The URL is what we pass to
 * `registerTool()` as the on-chain `metadataURI`.
 */
export function manifestWellKnownUrl(origin: string): string {
  // Slug must match ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ per spec; 'vibeify' is valid.
  return `${origin.replace(/\/$/, "")}/.well-known/ai-tool/vibeify.json`;
}
