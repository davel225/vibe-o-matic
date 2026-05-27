/**
 * Payment configuration for vibe-o-matic.
 *
 * Every "Vibe-ify" pull charges TOTAL_VIBESTR, split across SPLIT_RECIPIENTS
 * via separate on-chain Transfer events. Percentages must sum to 100 and the
 * total must be evenly divisible — adjust both freely.
 *
 * To change the price: edit TOTAL_VIBESTR.
 * To change the split: edit SPLIT_RECIPIENTS (add / remove rows, change %).
 * To change the treasury wallet: edit the first row's address.
 */

export const VIBESTR_ADDRESS =
  "0xd0cC2b0eFb168bFe1f94a948D8df70FA10257196" as const;

export const VIBESTR_DECIMALS = 18;

/** Total VIBESTR charged per pull (whole tokens). */
export const TOTAL_VIBESTR = 99n;

/** Raw on-chain amount = TOTAL_VIBESTR * 10^18. */
export const TOTAL_VIBESTR_RAW = TOTAL_VIBESTR * 10n ** BigInt(VIBESTR_DECIMALS);

export const BURN_ADDRESS =
  "0x000000000000000000000000000000000000dEaD" as const;

export type SplitRecipient = {
  /** Short label shown in the UI (e.g. "Treasury", "Burn"). */
  name: string;
  /** Recipient wallet address. */
  address: `0x${string}`;
  /** Whole-percent share (1–100). All rows must sum to 100. */
  percent: number;
};

export const SPLIT_RECIPIENTS: readonly SplitRecipient[] = [
  {
    name: "Treasury",
    address: "0xc93c375b022f0e707d211090d904f3266ccfce22",
    percent: 100,
  },
] as const;

// ── Derived ─────────────────────────────────────────────────────────

/** Per-recipient raw amounts in the same order as SPLIT_RECIPIENTS. */
export function getSplitAmounts(): readonly bigint[] {
  const sum = SPLIT_RECIPIENTS.reduce((s, r) => s + r.percent, 0);
  if (sum !== 100) {
    throw new Error(
      `SPLIT_RECIPIENTS percentages must sum to 100 (got ${sum}). Edit lib/payment-config.ts.`
    );
  }
  return SPLIT_RECIPIENTS.map(
    (r) => (TOTAL_VIBESTR_RAW * BigInt(r.percent)) / 100n
  );
}

/** Display string like "180 + 20 VIBESTR (Treasury + Burn)". */
export function getSplitSummary(): string {
  const parts = SPLIT_RECIPIENTS.map(
    (r) => `${(Number(TOTAL_VIBESTR) * r.percent) / 100} → ${r.name}`
  );
  return parts.join(" · ");
}

// ── Network ─────────────────────────────────────────────────────────

export const CHAIN_ID = 1; // Ethereum mainnet
export const RPC_URL = "https://ethereum-rpc.publicnode.com";

// ── x402 / USDC payment rail (Base mainnet) ─────────────────────────
// Live production config: Base mainnet, real USDC. Every call charges the
// caller $0.69 real money. Treasury (USDC_RECIPIENT) is an EVM-network-
// agnostic address — confirm you control it on Base mainnet before
// accepting volume. To roll back to testnet, flip network/chainId/CAIP
// in this block + the USDC contract address in lib/wallet.ts (the Sepolia
// USDC is at 0x036CbD53842c5426634e7929541eC2318f3dCF7e).
export const USDC_NETWORK = "base" as const;
export const USDC_CHAIN_ID = 8453;
export const USDC_NETWORK_CAIP = "eip155:8453" as const;
export const USDC_PRICE_DOLLARS = "$0.69";
export const USDC_RECIPIENT =
  "0xc93c375b022f0e707d211090d904f3266ccfce22" as const;
// Public x402 facilitator (handles signature verification + on-chain
// settlement so our server doesn't need a wallet or RPC). NOTE: the URL is
// x402.org/facilitator, NOT facilitator.x402.org — the subdomain form does
// not resolve. The same facilitator serves both Base Sepolia and Base
// mainnet; no URL change needed when flipping networks.
export const X402_FACILITATOR_URL = "https://x402.org/facilitator";
