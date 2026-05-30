"use client";

import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  parseAbi,
  publicActions,
  type Hex,
} from "viem";
import { base, mainnet } from "viem/chains";
import { wrapFetchWithPayment } from "x402-fetch";
import {
  CHAIN_ID,
  RPC_URL,
  SPLIT_RECIPIENTS,
  USDC_CHAIN_ID,
  VIBESTR_ADDRESS,
  getSplitAmounts,
} from "./payment-config";

const erc20Abi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
]);

// VIBESTR transfer gating note
// ─────────────────────────────
// VIBESTR (ViBeStrategy, 0xd0cC2b…7196) is not a free p2p ERC-20: its internal
// _transfer enforces a private RECIPIENT ALLOWLIST. Vanilla `transfer(to,
// amount)` succeeds if `to` is on the allowlist and reverts with
// InsufficientAllowance(0x2f352531) otherwise — regardless of sender balance
// or any self-allowance. The contract exposes no public getter for the list.
//
// Proven via tx 0xe3c0eb968884c637e4fa99a0dadc280510f8808ce262d0067c46cf64599d8805
// (an 800 VIBESTR transfer to a GVC game wallet that succeeded) compared to
// our same-shape transfer to USDC_RECIPIENT which reverts.
//
// → Our treasury USDC_RECIPIENT (see payment-config.ts) needs to be added to
//   the allowlist by the GVC team. Once added, the plain ERC-20 transfer
//   below will Just Work — no preflight, no allowance dance, no code change.
// → While we're awaiting the allowlist addition, every VIBESTR payment attempt
//   will revert. The web UI's test-mode bypass remains the unblocked demo
//   path, and the x402 USDC rail handles autonomous-agent payments fully.

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ethereum?: any;
  }
}

function eth() {
  if (typeof window === "undefined" || !window.ethereum) {
    throw new Error(
      "No wallet detected. Install MetaMask (or another browser wallet) and reload."
    );
  }
  return window.ethereum;
}

export async function connectWallet(): Promise<`0x${string}`> {
  const provider = eth();
  const accounts = (await provider.request({
    method: "eth_requestAccounts",
  })) as `0x${string}`[];
  if (!accounts?.[0]) throw new Error("No account returned from wallet.");
  return accounts[0];
}

export async function getChainId(): Promise<number> {
  const provider = eth();
  const hex = (await provider.request({ method: "eth_chainId" })) as string;
  return parseInt(hex, 16);
}

export async function ensureMainnet() {
  await ensureChain(CHAIN_ID, "Ethereum Mainnet");
}

export async function ensureBase() {
  await ensureChain(USDC_CHAIN_ID, "Base");
}

async function ensureChain(wantChainId: number, label: string) {
  const cur = await getChainId();
  if (cur === wantChainId) return;
  const provider = eth();
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: `0x${wantChainId.toString(16)}` }],
    });
  } catch (e) {
    // 4902 = chain not added to wallet
    if ((e as { code?: number })?.code === 4902 && wantChainId === USDC_CHAIN_ID) {
      try {
        // Base mainnet params. The chainId comes from USDC_CHAIN_ID (8453),
        // which is the production constant — DO NOT hardcode the hex here.
        // If lib/payment-config.ts is ever rolled back to base-sepolia (84532)
        // for a testnet recovery, this fallback should also revert to
        // chainName "Base Sepolia" + sepolia.base.org RPC + sepolia.basescan.org.
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: `0x${USDC_CHAIN_ID.toString(16)}`,
              chainName: "Base",
              nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://mainnet.base.org"],
              blockExplorerUrls: ["https://basescan.org"],
            },
          ],
        });
        return;
      } catch {
        throw new Error(`Please add and switch to ${label}.`);
      }
    }
    throw new Error(`Please switch your wallet to ${label}.`);
  }
}

const publicClient = createPublicClient({
  chain: mainnet,
  transport: http(RPC_URL),
});

export async function getVibestrBalance(addr: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: VIBESTR_ADDRESS,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;
}

/**
 * GVC NFT contract (Good Vibes Club — Citizen of Vibetown ERC-721) on
 * Ethereum mainnet. Used by the community-eligibility check for the
 * free-render program: any wallet holding ≥1 GVC token qualifies.
 *
 * Per CLAUDE.md / WIRING.md, this address is the canonical GVC NFT and
 * is treated as a read-only reference — never change it.
 */
export const GVC_NFT_ADDRESS =
  "0xB8Ea78fcaCEf50d41375E44E6814ebbA36Bb33c4" as const;

const gvcNftAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

/**
 * Count of GVC NFTs (Citizen of Vibetown) held by `addr` on Ethereum
 * mainnet. Used by the free-render community gate (FEEDBACK-V1.md §
 * Eligibility) — server-side reads only, via the same public RPC used
 * by `getVibestrBalance`.
 */
export async function getGvcNftBalance(addr: `0x${string}`): Promise<bigint> {
  return publicClient.readContract({
    address: GVC_NFT_ADDRESS,
    abi: gvcNftAbi,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;
}

export type PayProgress = {
  index: number;
  total: number;
  recipient: string;
};

/**
 * Pay the VIBESTR split (currently a single 100%-to-treasury transfer).
 *
 * This is a plain ERC-20 `transfer()` per recipient. Whether it succeeds
 * depends on the recipient being on VIBESTR's internal allowlist — see
 * the long comment above `erc20Abi` for the full story. Code path is
 * deliberately minimal so that the moment the GVC team adds our treasury
 * to the allowlist, payments start working with zero further changes.
 *
 * `existingHashes` lets the caller resume after a mid-flow failure: pass
 * any tx hashes already collected; only the remaining recipients are sent.
 */
export async function payVibestrSplit(
  payer: `0x${string}`,
  onProgress: (p: PayProgress) => void,
  existingHashes: Hex[] = []
): Promise<Hex[]> {
  await ensureMainnet();
  const provider = eth();
  const walletClient = createWalletClient({
    chain: mainnet,
    account: payer,
    transport: custom(provider),
  });

  const amounts = getSplitAmounts();
  const startIndex = existingHashes.length;
  const collected: Hex[] = [...existingHashes];

  for (let i = startIndex; i < SPLIT_RECIPIENTS.length; i++) {
    const recipient = SPLIT_RECIPIENTS[i];
    onProgress({
      index: i,
      total: SPLIT_RECIPIENTS.length,
      recipient: recipient.name,
    });
    const hash = await walletClient.writeContract({
      address: VIBESTR_ADDRESS,
      abi: erc20Abi,
      functionName: "transfer",
      args: [recipient.address, amounts[i]],
    });
    collected.push(hash);
  }
  return collected;
}

export function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

// ── x402 / USDC ────────────────────────────────────────────────────

const usdcAbi = parseAbi([
  "function balanceOf(address) view returns (uint256)",
]);

// USDC on Base mainnet (Circle's deployment).
// To roll back to Base Sepolia testnet, swap to 0x036CbD53842c5426634e7929541eC2318f3dCF7e
// and flip the chain constants in lib/payment-config.ts back to base-sepolia/84532.
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;

const basePublicClient = createPublicClient({
  chain: base,
  transport: http(),
});

export async function getUsdcBalanceBase(
  addr: `0x${string}`
): Promise<bigint> {
  return basePublicClient.readContract({
    address: USDC_BASE,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;
}

/**
 * Build a fetch that automatically handles 402 Payment Required responses
 * against the connected browser wallet on Base mainnet. The user signs an
 * EIP-3009 transferWithAuthorization off-chain — no gas, no second tx.
 *
 * The wrapper enforces a 1 USDC per-call ceiling (1_000_000 atomic units)
 * as a client-side safety rail above the server's $0.69 quote. If the
 * server ever asks for more than 1 USDC, the wrapper refuses to sign
 * before MetaMask is even prompted.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getX402Fetch(payer: `0x${string}`): Promise<any> {
  await ensureBase();
  const wallet = createWalletClient({
    account: payer,
    chain: base,
    transport: custom(eth()),
  }).extend(publicActions);
  // Max value the wrapper will auto-pay without prompting: 1 USDC (1_000_000 base units).
  // Our route asks for $0.69 so this gives some headroom for price tweaks.
  // The cast bridges a known viem-vs-x402-fetch Signer type lag — harmless at
  // runtime, the wallet client implements every method wrapFetchWithPayment
  // actually invokes (signTypedData, signTransaction, etc.).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return wrapFetchWithPayment(globalThis.fetch, wallet as any, 1_000_000n);
}
