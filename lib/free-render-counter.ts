/**
 * Atomic counter for the free-render program (FEEDBACK-V1.md § The 200-
 * render counter).
 *
 * Backed by Vercel KV (Upstash Redis under the hood). Three operations:
 *   - read(): returns { remaining, refillCount } for the public endpoint
 *   - decrement(): atomic DECR after a successful free render
 *   - refill(by): admin-only INCR, exposed via /api/admin/refill
 *
 * Graceful degrade: if KV is not provisioned yet (no env vars set), all
 * three operations return `null` / refuse to act. The route handlers
 * interpret null as "counter unavailable" and turn the free-render
 * surface off until KV is connected. This lets the code ship + deploy
 * before Vercel KV is created in the dashboard; the moment the env vars
 * land, the counter starts working with zero code changes.
 */

import { kv } from "@vercel/kv";

const REMAINING_KEY = "vibeify:free-renders:remaining";
const REFILL_COUNT_KEY = "vibeify:free-renders:refill-count";

/**
 * Detect whether Vercel KV is provisioned. The @vercel/kv client lazily
 * reads KV_REST_API_URL + KV_REST_API_TOKEN at call time and throws if
 * they're missing — we want to detect that upfront and return null so
 * the route handlers can degrade cleanly.
 */
function kvAvailable(): boolean {
  return !!(
    process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN
  );
}

export type CounterState = {
  /** Remaining free renders in the current cycle. Decrements after each free render. */
  remaining: number;
  /** How many times the admin endpoint has been called to top up. */
  refillCount: number;
};

/**
 * Read the public counter state. Returns null if KV is not provisioned
 * (route handlers should interpret this as "free-render program off").
 */
export async function readCounter(): Promise<CounterState | null> {
  if (!kvAvailable()) return null;
  try {
    const [remaining, refillCount] = await Promise.all([
      kv.get<number>(REMAINING_KEY),
      kv.get<number>(REFILL_COUNT_KEY),
    ]);
    return {
      remaining: typeof remaining === "number" ? remaining : 0,
      refillCount: typeof refillCount === "number" ? refillCount : 0,
    };
  } catch (e) {
    console.error(
      `[free-render-counter] read failed:`,
      (e as Error).message
    );
    return null;
  }
}

/**
 * Atomically decrement the counter. Returns the NEW value of remaining
 * after the decrement, or null if KV is unavailable / decrement failed.
 *
 * The route handler MUST call this AFTER the render succeeds — if it
 * fails before render, the counter would burn off-budget renders.
 */
export async function decrementCounter(): Promise<number | null> {
  if (!kvAvailable()) return null;
  try {
    const newValue = await kv.decr(REMAINING_KEY);
    return typeof newValue === "number" ? newValue : null;
  } catch (e) {
    console.error(
      `[free-render-counter] decrement failed:`,
      (e as Error).message
    );
    return null;
  }
}

/**
 * Admin-only refill. Adds `by` to the remaining counter and increments
 * the refill-count metric (so the UI can show "refilled N times this
 * month" or similar). Returns the new state, or null on failure.
 *
 * Caller is responsible for authorization (the route handler checks
 * the VIBEIFY_ADMIN_TOKEN env var).
 */
export async function refillCounter(
  by: number
): Promise<CounterState | null> {
  if (!kvAvailable()) return null;
  if (by <= 0 || !Number.isInteger(by)) return null;
  try {
    const [remaining, refillCount] = await Promise.all([
      kv.incrby(REMAINING_KEY, by),
      kv.incr(REFILL_COUNT_KEY),
    ]);
    return {
      remaining: typeof remaining === "number" ? remaining : 0,
      refillCount: typeof refillCount === "number" ? refillCount : 0,
    };
  } catch (e) {
    console.error(
      `[free-render-counter] refill failed:`,
      (e as Error).message
    );
    return null;
  }
}

/**
 * Whether the free-render program is "open" — KV provisioned AND
 * remaining > 0. Convenience for the render route's branching.
 */
export async function isFreeRenderProgramOpen(): Promise<boolean> {
  const state = await readCounter();
  return !!state && state.remaining > 0;
}
