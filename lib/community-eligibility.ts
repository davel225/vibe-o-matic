/**
 * GVC community-eligibility check for the free-render program.
 *
 * Spec: FEEDBACK-V1.md § Eligibility. A wallet qualifies if EITHER:
 *   - It holds ≥ 1 GVC NFT (Citizen of Vibetown ERC-721)
 *   - It holds ≥ 69,000 whole VIBESTR (ERC-20, 18 decimals)
 *
 * Both reads run server-side via the same public Ethereum RPC the rest
 * of the project uses (publicnode.com). Results are cached for 5 minutes
 * per wallet in an in-memory Map so a single render attempt doesn't
 * generate redundant RPC calls when the same wallet posts multiple
 * times in quick succession.
 *
 * The cache is process-local — on Vercel's serverless runtime, each cold
 * start gets a fresh Map. That's fine: at our volume, RPC reads are
 * cheap and the cache mainly protects against burst calls within a
 * single function invocation lifetime.
 */

import { createPublicClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";
import { RPC_URL, VIBESTR_ADDRESS, VIBESTR_DECIMALS } from "./payment-config";
import { GVC_NFT_ADDRESS } from "./wallet";

const VIBESTR_THRESHOLD_WHOLE = 69_000n;
const VIBESTR_THRESHOLD_RAW =
  VIBESTR_THRESHOLD_WHOLE * 10n ** BigInt(VIBESTR_DECIMALS);

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes per FEEDBACK-V1.md

export type Eligibility = {
  /** True iff the wallet meets at least one of the dual conditions. */
  isMember: boolean;
  /** Which path qualified them (for the UI sub-label). */
  qualifier: "gvc-nft" | "vibestr" | "both" | "none";
  /** Raw on-chain reads, for transparency in the UI badge. */
  gvcCount: bigint;
  vibestrBalance: bigint;
  /** Whole-VIBESTR convenience for UI ("123,456 VIBESTR"). */
  vibestrWhole: bigint;
};

type CacheEntry = { result: Eligibility; ts: number };
const cache = new Map<string, CacheEntry>();

const ethClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

/**
 * Compute (and cache) the community eligibility for `wallet`.
 *
 * `wallet` is normalized to lowercase for cache lookups so case
 * variations in the address don't fragment the cache.
 *
 * On RPC failure: returns the "none" eligibility — fail closed so a
 * broken RPC can't accidentally grant free renders. Errors are logged
 * to the server console but never thrown to the caller; the caller
 * route can treat the result as authoritative.
 */
export async function checkCommunityEligibility(
  wallet: `0x${string}`
): Promise<Eligibility> {
  const key = wallet.toLowerCase();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL_MS) {
    return hit.result;
  }

  try {
    const [gvcCount, vibestrBalance] = await Promise.all([
      ethClient.readContract({
        address: GVC_NFT_ADDRESS,
        abi: erc20Abi, // balanceOf is interface-compatible across 721 + 20
        functionName: "balanceOf",
        args: [wallet],
      }) as Promise<bigint>,
      ethClient.readContract({
        address: VIBESTR_ADDRESS,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [wallet],
      }) as Promise<bigint>,
    ]);

    const gvcQualifies = gvcCount >= 1n;
    const vibestrQualifies = vibestrBalance >= VIBESTR_THRESHOLD_RAW;
    const qualifier: Eligibility["qualifier"] =
      gvcQualifies && vibestrQualifies
        ? "both"
        : gvcQualifies
        ? "gvc-nft"
        : vibestrQualifies
        ? "vibestr"
        : "none";

    const result: Eligibility = {
      isMember: gvcQualifies || vibestrQualifies,
      qualifier,
      gvcCount,
      vibestrBalance,
      vibestrWhole: vibestrBalance / 10n ** BigInt(VIBESTR_DECIMALS),
    };

    cache.set(key, { result, ts: Date.now() });
    return result;
  } catch (e) {
    console.error(
      `[community-eligibility] RPC read failed for ${wallet}:`,
      (e as Error).message
    );
    // Fail closed — never grant free renders on a broken RPC read.
    return {
      isMember: false,
      qualifier: "none",
      gvcCount: 0n,
      vibestrBalance: 0n,
      vibestrWhole: 0n,
    };
  }
}

/** The VIBESTR threshold, exposed for tests + UI display. */
export const VIBESTR_THRESHOLD = {
  whole: VIBESTR_THRESHOLD_WHOLE,
  raw: VIBESTR_THRESHOLD_RAW,
};
