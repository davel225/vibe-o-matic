# vibe-o-matic — launch checklist

Everything that must change before flipping vibe-o-matic from "hackathon demo" to "live, accepting real money on both rails."

The hackathon build runs:
- **VIBESTR rail**: ✅ Ethereum mainnet (production-ready)
- **USDC rail**: ⚠️ Base **Sepolia** (testnet — needs flip)
- **Test bypass**: 🟡 Enabled via env var (must be off in prod)

This doc captures what each change is, why it matters, and how to roll back if anything misbehaves.

---

## 🚦 The headline change: flip USDC from Base Sepolia → Base mainnet

Three coordinated edits. Do them in the same commit so the network, chain id, and contract address can't drift apart.

### 1. `lib/payment-config.ts`

```diff
- export const USDC_NETWORK = "base-sepolia" as const;
- export const USDC_CHAIN_ID = 84532;
- export const USDC_NETWORK_CAIP = "eip155:84532" as const;
+ export const USDC_NETWORK = "base" as const;
+ export const USDC_CHAIN_ID = 8453;
+ export const USDC_NETWORK_CAIP = "eip155:8453" as const;
```

`USDC_PRICE_DOLLARS` ($0.69), `USDC_RECIPIENT`, and `X402_FACILITATOR_URL` stay the same — the facilitator at `https://x402.org/facilitator` supports both networks.

### 2. `lib/wallet.ts`

The USDC contract address differs between Sepolia and mainnet:

```diff
- // USDC on Base Sepolia (Circle's deployment)
- const USDC_BASE_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const;
+ // USDC on Base mainnet (Circle's deployment)
+ const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
```

Update the variable name and rename `getUsdcBalanceBaseSepolia()` → `getUsdcBalanceBase()`. Update the `basePublicClient` to use `base` chain (from `viem/chains`) instead of `baseSepolia`.

Rename `ensureBaseSepolia()` → `ensureBase()` and point it at chain id `8453` with mainnet RPC.

Update all callers in `lib/wallet.ts` and any imports in `app/page.tsx`.

### 3. `scripts/test-x402-agent.mjs`

```diff
- import { baseSepolia } from "viem/chains";
+ import { base } from "viem/chains";

  const wallet = createWalletClient({
    account,
-   chain: baseSepolia,
+   chain: base,
    transport: http(),
  });
```

After this, the script charges real USDC on Base mainnet — don't run it casually.

---

## 🔒 Disable the test bypass

`VIBEIFY_ALLOW_BYPASS=1` enables the test-mode toggle in the web UI (renders without payment). **This must not be set in the production Vercel environment.**

### How to verify in Vercel
1. Vercel dashboard → vibe-o-matic project → Settings → Environment Variables
2. Confirm `VIBEIFY_ALLOW_BYPASS` is **absent** (or explicitly set to `0`) for the Production environment
3. Leave it set to `1` in Preview / Development environments so we can keep testing without paying

### Why this matters
The bypass flag is server-gated — even if a malicious client sends `bypass=1` in the form, the server checks `VIBEIFY_ALLOW_BYPASS === "1"` before honoring it. So leaving it accidentally enabled in production would let anyone render for free.

---

## 🔑 Required production env vars

| Var | Where | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | Vercel → Production | gpt-4o-mini (describer + agent picker) |
| `BFL_API_KEY` | Vercel → Production | Flux 2 [pro] image generation |
| `VIBEIFY_ALLOW_BYPASS` | **Production: unset.** Preview/Dev: `1` | Test-mode bypass gate (server-side) |

No private keys live in env. The server never holds a wallet — the facilitator handles all on-chain interactions for the USDC rail, and the VIBESTR rail only verifies user-signed transactions.

---

## 💰 Pre-launch funding & address sanity check

Before flipping, verify the treasury / split addresses are correct on both networks:

### VIBESTR (Ethereum mainnet)
Recipient addresses in `SPLIT_RECIPIENTS`:
- Treasury: `0xc93c375b022f0e707d211090d904f3266ccfce22` (90%)
- Burn: `0x000000000000000000000000000000000000dEaD` (10%)

Same VIBESTR contract on mainnet: `0xd0cC2b0eFb168bFe1f94a948D8df70FA10257196`

### USDC (Base mainnet)
- Recipient: `USDC_RECIPIENT` in `lib/payment-config.ts` → currently `0xc93c375b022f0e707d211090d904f3266ccfce22`
- Confirm this address is one you control on Base mainnet (EVM addresses are network-agnostic, but the wallet must exist)
- USDC contract: `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` (Circle's Base mainnet deployment)

---

## 🚀 Deploy steps (in order)

1. **Branch**: `git checkout -b launch/mainnet-flip`
2. **Apply changes**: the three diffs in section 🚦 above
3. **Verify locally**: `npm run dev`, open http://localhost:3000, confirm MetaMask prompts to switch to **Base** (chain 8453, not Sepolia 84532) when clicking Vibeify on USDC rail
4. **DO NOT actually pay locally** — the local test would charge real USDC. Just verify the network switch happens.
5. **Commit + push**: `git commit -am "launch: flip USDC rail to Base mainnet"` then `git push -u origin launch/mainnet-flip`
6. **Vercel preview deploy**: hits automatically; verify production env vars are set (esp. `VIBEIFY_ALLOW_BYPASS` is **absent** in Production)
7. **Smoke test on preview URL** with a wallet that has 0.69+ USDC on Base mainnet — one real payment, verify it lands at the treasury address on Basescan
8. **Merge to main → production deploy**
9. **Post-launch verification**:
   - GET `/api/vibeify/x402` → confirm `network: "base"` in the response
   - One paid render via the web UI on each rail
   - Confirm `X-PAYMENT-RESPONSE` header carries a real Base mainnet tx hash

---

## 🆘 Rollback

If something goes wrong post-launch (broken render, payments going to the wrong address, anything weird):

1. **Revert the launch commit** on the Vercel main branch — instant rollback to the previous deploy
2. The previous deploy points at Base Sepolia, so any USDC payments in-flight at rollback time would be Base mainnet payments hitting a server that expects Sepolia → they'd fail verification and the caller wouldn't be charged (facilitator settles AFTER verification + render)
3. Affected users see a 402 with an error message; no money moves; their wallets are safe

The verify-before-render / settle-after-render ordering in `app/api/vibeify/x402/route.ts` makes the system **atomic across rollbacks** — there's no state where someone paid but didn't get a render, or got a render but didn't pay.

---

## 📋 Cutover checklist (printable)

Run through this on launch day:

- [ ] `USDC_NETWORK` flipped to `"base"` in `lib/payment-config.ts`
- [ ] `USDC_CHAIN_ID` flipped to `8453`
- [ ] `USDC_NETWORK_CAIP` flipped to `"eip155:8453"`
- [ ] USDC contract address updated in `lib/wallet.ts` to mainnet (`0x833589fCD…`)
- [ ] `ensureBaseSepolia` → `ensureBase` renamed and pointed at mainnet
- [ ] `getUsdcBalanceBaseSepolia` → `getUsdcBalanceBase` renamed
- [ ] All callers in `app/page.tsx` updated to new function names
- [ ] `scripts/test-x402-agent.mjs` updated to import `base` instead of `baseSepolia`
- [ ] `VIBEIFY_ALLOW_BYPASS` verified **absent** in Vercel Production env
- [ ] `OPENAI_API_KEY` set in Vercel Production env
- [ ] `BFL_API_KEY` set in Vercel Production env
- [ ] `USDC_RECIPIENT` confirmed as a wallet you control on Base mainnet
- [ ] VIBESTR `SPLIT_RECIPIENTS` confirmed correct on Ethereum mainnet
- [ ] Smoke test passed on Vercel preview URL with a real USDC payment
- [ ] Smoke test passed on Vercel preview URL with a real VIBESTR payment
- [ ] Production deploy confirmed serving the new code (GET `/api/vibeify/x402` returns `network: "base"`)
- [ ] One end-to-end paid render on each rail in production
- [ ] tx hashes verified on Basescan (USDC) and Etherscan (VIBESTR)

---

*Keep this doc updated as the system evolves. Anything that would need to change between testnet and mainnet belongs here.*
