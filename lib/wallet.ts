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
import { baseSepolia, mainnet } from "viem/chains";
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

// VIBESTR (ViBeStrategy) is a non-standard ERC-20: direct transfers from your
// own wallet require a pre-set "transfer allowance" — a self-imposed spending
// budget. transfer() reverts with `InsufficientAllowance` if the sender hasn't
// authorized enough. Both allowance functions operate on msg.sender (no
// address parameter), so to read an arbitrary user's allowance via eth_call
// we have to pass `account` in readContract — viem sets that on the `from`
// field, which the contract sees as msg.sender.
const vibestrAllowanceAbi = parseAbi([
  "function getTransferAllowance() view returns (uint256)",
  "function increaseTransferAllowance(uint256 amountAllowed)",
]);

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

export async function ensureBaseSepolia() {
  await ensureChain(USDC_CHAIN_ID, "Base Sepolia");
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
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: `0x${USDC_CHAIN_ID.toString(16)}`,
              chainName: "Base Sepolia",
              nativeCurrency: { name: "Sepolia ETH", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://sepolia.base.org"],
              blockExplorerUrls: ["https://sepolia.basescan.org"],
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
 * Read the caller's current VIBESTR transfer allowance — a self-imposed
 * spending budget that VIBESTR's non-standard ERC-20 requires before any
 * direct transfer succeeds. See vibestrAllowanceAbi comment for context.
 */
export async function getVibestrTransferAllowance(
  addr: `0x${string}`
): Promise<bigint> {
  // getTransferAllowance() uses msg.sender internally — passing `account`
  // here populates eth_call's `from` field so the contract resolves it
  // to the user's address rather than the zero address.
  return publicClient.readContract({
    address: VIBESTR_ADDRESS,
    abi: vibestrAllowanceAbi,
    functionName: "getTransferAllowance",
    account: addr,
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
 * VIBESTR-specific: before the transfer, we check the caller's current
 * `getTransferAllowance(payer)`. If it's below TOTAL_VIBESTR_RAW, we
 * prepend an `increaseTransferAllowance(balance)` tx — sized to the
 * caller's full VIBESTR balance so a one-time setup covers many future
 * renders. Once set, allowance persists across renders until it's
 * drained by transfers, at which point we top up again automatically.
 *
 * `existingHashes` lets the caller resume after a mid-flow failure:
 * pass any tx hashes already collected; only the remaining steps will
 * be re-attempted. Note: the allowance tx is NOT counted in the returned
 * hashes (server verifies transfers only, not allowance setup).
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
  const totalNeeded = amounts.reduce((s, a) => s + a, 0n);

  // ── Allowance preflight (only if first transfer hasn't gone yet) ──
  // If we're resuming a partial payment, the allowance already exists by
  // definition (an earlier transfer succeeded), so we skip this step.
  if (existingHashes.length === 0) {
    const current = await getVibestrTransferAllowance(payer);
    if (current < totalNeeded) {
      const balance = await getVibestrBalance(payer);
      // increaseTransferAllowance ADDS to current — passing `balance` puts the
      // new ceiling at (current + balance), comfortably above any single render
      // and giving roughly `balance / 99` renders before the next top-up.
      onProgress({
        index: 0,
        total: SPLIT_RECIPIENTS.length + 1,
        recipient: "Transfer allowance (1-time setup)",
      });
      const allowanceHash = await walletClient.writeContract({
        address: VIBESTR_ADDRESS,
        abi: vibestrAllowanceAbi,
        functionName: "increaseTransferAllowance",
        args: [balance],
      });
      // Wait for inclusion so the subsequent transfer sees the updated state.
      await publicClient.waitForTransactionReceipt({ hash: allowanceHash });
    }
  }

  // ── Split transfers ──
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

// USDC on Base Sepolia (Circle's deployment)
const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;

const basePublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});

export async function getUsdcBalanceBaseSepolia(
  addr: `0x${string}`
): Promise<bigint> {
  return basePublicClient.readContract({
    address: USDC_BASE_SEPOLIA,
    abi: usdcAbi,
    functionName: "balanceOf",
    args: [addr],
  }) as Promise<bigint>;
}

/**
 * Build a fetch that automatically handles 402 Payment Required responses
 * against the connected browser wallet on Base Sepolia. The user signs an
 * EIP-3009 transferWithAuthorization off-chain — no gas, no second tx.
 *
 * NOTE: This helper is currently DORMANT. The web UI removed the USDC payment
 * toggle (web UI is VIBESTR-only by design — see SUBMISSION.md). It's kept
 * here because the agentic story might bring it back, and because the
 * server-side x402 route + the headless agent test script remain live.
 * If you re-enable an in-browser USDC flow, this function is the entry point.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getX402Fetch(payer: `0x${string}`): Promise<any> {
  await ensureBaseSepolia();
  const wallet = createWalletClient({
    account: payer,
    chain: baseSepolia,
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
