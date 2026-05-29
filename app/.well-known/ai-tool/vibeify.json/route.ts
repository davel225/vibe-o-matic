/**
 * ERC-8257 tool manifest endpoint.
 *
 * Serves the JCS-canonicalized form of the manifest defined in
 * lib/erc8257-manifest.ts at the URL the on-chain registry expects:
 *   https://vibe-o-matic.vercel.app/.well-known/ai-tool/vibeify.json
 *
 * CRITICAL: the bytes served here MUST be byte-equal to whatever
 * `keccak256(JCS(VIBEIFY_MANIFEST))` was computed against during
 * registration. We achieve that by:
 *   1. Using the SAME `canonicalize` npm package (RFC 8785 reference impl)
 *     that scripts/erc8257-hash.mjs uses to compute the hash
 *   2. Sending UTF-8 bytes WITHOUT a BOM
 *   3. Caching the canonical bytes at module load so we don't re-stringify
 *      on every request (would still be deterministic, but waste CPU)
 *
 * Per spec: consumers MUST reject the manifest if the BOM is present,
 * non-NFC strings appear, uppercase hex shows up, or the response is 3xx.
 * The route here returns 200 with the exact canonical body and no other
 * processing.
 */

import canonicalize from "canonicalize";
import { VIBEIFY_MANIFEST } from "@/lib/erc8257-manifest";

// Canonicalize once at module load. The result is deterministic across
// runs — same input always yields the same output bytes.
const CANONICAL_BODY = canonicalize(VIBEIFY_MANIFEST) ?? "";

export function GET() {
  // Use the global Response (not NextResponse.json) so we have full control
  // over the body bytes. NextResponse.json would re-stringify with its own
  // formatting and break the hash commitment.
  return new Response(CANONICAL_BODY, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Cache for 1 hour — spec recommends ≤24h cache for any invocation-
      // capable surface, ≤5m for latency-sensitive UIs. 1h is the safe
      // middle. Registry indexers re-verify on every use anyway.
      "cache-control": "public, max-age=3600",
    },
  });
}

// Edge runtime would be ideal here (smaller cold-start budget) but
// canonicalize uses no Node-specific APIs so the default Node runtime
// is fine and matches the rest of the deploy.
