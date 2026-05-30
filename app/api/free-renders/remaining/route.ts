/**
 * Public read endpoint for the free-render program counter.
 *
 * Spec: FEEDBACK-V1.md § The 200-render counter.
 *
 * Returns { remaining, refillCount } when Vercel KV is provisioned.
 * Returns { available: false } when KV isn't connected — the UI uses
 * this signal to hide the free-render pill until ops finishes the
 * Vercel KV setup.
 *
 * No-cache so the public counter is always live. The endpoint is cheap
 * (one Redis GET) — we don't need edge caching for it.
 */

import { NextResponse } from "next/server";
import { readCounter } from "@/lib/free-render-counter";

export async function GET() {
  const state = await readCounter();
  if (!state) {
    return NextResponse.json(
      { available: false },
      { headers: { "cache-control": "no-store" } }
    );
  }
  return NextResponse.json(
    {
      available: true,
      remaining: state.remaining,
      refillCount: state.refillCount,
    },
    { headers: { "cache-control": "no-store" } }
  );
}
