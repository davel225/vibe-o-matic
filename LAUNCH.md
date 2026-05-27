# vibe-o-matic — launch state & operations

Operational reference for the **live production deploy**. Originally written
as a pre-launch flip checklist (testnet → mainnet); rewritten in commit
`a513329` once the mainnet flip shipped.

---

## ✅ Current production state

| Component | State | Network | Notes |
|---|---|---|---|
| **Live URL** | ✅ shipping | – | https://vibe-o-matic.vercel.app |
| **Source** | ✅ public | – | https://github.com/davel225/vibe-o-matic (branch `main`) |
| **Web UI USDC rail** | ✅ live | Base mainnet (8453) | Default rail. $0.69 USDC per render. Settles via [x402 facilitator](https://x402.org/facilitator). |
| **Web UI VIBESTR rail** | ⏳ pending | Ethereum mainnet (1) | Shown as `SOON` pill. Awaiting GVC team adding our treasury to VIBESTR's recipient allowlist. |
| **x402 agent endpoint** | ✅ live | Base mainnet (8453) | `POST /api/vibeify/x402` — machine-callable, identical USDC settlement. |
| **Test-mode bypass** | 🔒 disabled in prod | – | `VIBEIFY_ALLOW_BYPASS` must remain **unset** in Vercel Production env. |

### Treasury / payment addresses

| Rail | Recipient | Contract |
|---|---|---|
| USDC | `0xc93c375b022f0e707d211090d904f3266ccfce22` (Base mainnet) | USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| VIBESTR | `0xc93c375b022f0e707d211090d904f3266ccfce22` (Ethereum mainnet) | VIBESTR `0xd0cC2b0eFb168bFe1f94a948D8df70FA10257196` |

EVM addresses are network-agnostic; the same `0xc93c375b…cfce22` receives on both
chains. **Verify control of that wallet on Base mainnet before pointing volume at
it** — funds sent to an uncontrolled address are unrecoverable.

---

## ⏳ Pending: VIBESTR allowlist add

VIBESTR's `_transfer` enforces a private internal recipient allowlist. Transfers
to allowlisted addresses succeed; any other recipient reverts with
`InsufficientAllowance` (`0x2f352531`) regardless of sender balance. The GVC
team has been asked to add `0xc93c375b022f0e707d211090d904f3266ccfce22` to the
list.

### How to verify the allowlist add landed

```bash
node --input-type=module -e "
import { createPublicClient, http, parseAbi } from 'viem';
import { mainnet } from 'viem/chains';
const c = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com') });
try {
  await c.simulateContract({
    address: '0xd0cC2b0eFb168bFe1f94a948D8df70FA10257196',
    abi: parseAbi(['function transfer(address,uint256) returns (bool)']),
    functionName: 'transfer',
    args: ['0xc93c375b022f0e707d211090d904f3266ccfce22', 99n * 10n ** 18n],
    account: '0xac1e7beae9fcf9b4f294cd534cd0b1ae1ef44793',
  });
  console.log('✓ Allowlist is LIVE — re-enable VIBESTR rail in the UI');
} catch (e) {
  console.log('✗ Still gated — allowlist add has not landed yet');
}
"
```

### How to re-enable the VIBESTR rail in the UI once it lands

Two small edits in `app/page.tsx`:

1. Find the disabled VIBESTR `<button>` in the rail-toggle block (search for `SOON` text)
2. Replace its `onClick` (currently shows the "coming soon" toast) with `() => setPaymentRail("vibestr")`
3. Remove the `cursor-not-allowed` class and the `<span>SOON</span>` pill, copy the styling pattern from the USDC button (active gold when selected, hover-light otherwise)

That's the whole change. The server-side route, the `payVibestrSplit` helper,
and the `verifyPayment` function are already production-ready and wait for
nothing.

---

## 🔑 Required production env vars (Vercel)

| Var | Production value | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | (set) | gpt-4o-mini describer + x402 agent picker |
| `BFL_API_KEY` | (set) | Flux 2 [pro] image generation |
| `VIBEIFY_ALLOW_BYPASS` | **unset** (or `0`) | Server-side gate for the test-mode bypass. Must be absent in Production; safe to set to `1` in Preview/Dev. |

No private keys live in env. The server never holds a wallet — the x402
facilitator handles all on-chain interactions; the VIBESTR route only verifies
user-signed transactions on Ethereum mainnet via a public RPC.

---

## 🩺 Production health checks

### Quick smoke test (no payment required)

```bash
# Homepage + x402 discovery should both 200
curl -fsS -o /dev/null -w "homepage:    %{http_code}\n" https://vibe-o-matic.vercel.app/
curl -fsS -w "\n" https://vibe-o-matic.vercel.app/api/vibeify/x402 | head -c 200
```

Expected discovery body:
```json
{"network":"base","price":"$0.69","payTo":"0xc93c375b022f0e707d211090d904f3266ccfce22","facilitator":"https://x402.org/facilitator"}
```

If `network` returns anything other than `"base"`, the deploy is serving stale
code — redeploy from Vercel dashboard.

### Treasury balance check (Base mainnet USDC)

```bash
node --input-type=module -e "
import { createPublicClient, http, formatUnits, parseAbi } from 'viem';
import { base } from 'viem/chains';
const c = createPublicClient({ chain: base, transport: http() });
const bal = await c.readContract({
  address: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  abi: parseAbi(['function balanceOf(address) view returns (uint256)']),
  functionName: 'balanceOf',
  args: ['0xc93c375b022f0e707d211090d904f3266ccfce22'],
});
console.log('Treasury USDC on Base:', formatUnits(bal, 6));
"
```

Growth in that number over time = renders are settling correctly.

### Server logs (Vercel)

`vercel logs --since 1h` (or the dashboard). The route logs:
- `[vibeify] start size=… mime=… bufferBytes=…` per request
- `[vibeify] describer ok (N chars)` after gpt-4o-mini succeeds
- `[vibeify] Flux render failed …` on render errors (with reason)
- `[vibeify-x402] 402: …` on x402 verification / settlement failures (with reason)

---

## 🆘 Rollback procedures

### Generic: Vercel-side revert (safest)

If the latest deploy is broken, instant rollback:
1. Vercel dashboard → vibe-o-matic project → Deployments
2. Find the last known-good deploy → ⋯ menu → **Promote to Production**

No git changes needed. Fastest path out of a bad deploy.

### Mainnet → Sepolia (if the USDC rail itself has problems)

If you need to take the USDC rail off real money temporarily (e.g.
facilitator outage, suspected wallet compromise), revert these constants:

```ts
// lib/payment-config.ts
export const USDC_NETWORK      = "base-sepolia" as const;
export const USDC_CHAIN_ID     = 84532;
export const USDC_NETWORK_CAIP = "eip155:84532" as const;

// lib/wallet.ts
const USDC_BASE = "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as const; // Sepolia
const basePublicClient = createPublicClient({ chain: baseSepolia, transport: http() });
//                                                   ^^^^^^^^^^^^
// (also `import { baseSepolia } from "viem/chains"`)
//
// scripts/test-x402-agent.mjs: same baseSepolia swap.
```

After this, all USDC payments target testnet — the live production app continues
to function, but no real money moves. Communicate the temporary state externally
since callers' real-USDC wallets will be on the wrong network.

### Why users are never half-charged

`/api/vibeify/x402` does `verify → render → settle` in that order. If render
fails (502), `settle` is never called — caller's USDC stays in their wallet. If
settlement fails after a successful render, the response carries 402 + an
error — caller sees a failure and is not charged. The system is **atomic
across rollbacks**: there's no state where someone paid but didn't get a
render, or got a render but didn't pay.

---

## 📋 Post-launch verification (done at flip time, kept for reference)

The mainnet flip shipped in `a513329`. The verification at that time:

- [x] `USDC_NETWORK` = `"base"` in `lib/payment-config.ts`
- [x] `USDC_CHAIN_ID` = `8453`
- [x] `USDC_NETWORK_CAIP` = `"eip155:8453"`
- [x] USDC contract = mainnet `0x833589fCD…2913` in `lib/wallet.ts`
- [x] `ensureBase`, `getUsdcBalanceBase` (renamed from Sepolia counterparts)
- [x] `scripts/test-x402-agent.mjs` imports `base` from `viem/chains`
- [x] `VIBEIFY_ALLOW_BYPASS` unset in Vercel Production
- [x] `OPENAI_API_KEY` + `BFL_API_KEY` set in Vercel Production
- [x] `npm run build` clean locally
- [x] `GET /api/vibeify/x402` returns `network: "base"` from the deployed URL
- [x] Homepage returns 200
- [ ] First real $0.69 USDC paid render end-to-end on the live URL → tx hash on Basescan
- [ ] First VIBESTR paid render (blocked on allowlist add)

---

## 📌 Known follow-ups (not blockers)

- **VIBESTR allowlist add** — see "Pending" section above. The one-line code re-enable will land the moment GVC confirms.
- **Next.js security patch** — `next@14.2.15` has an advisory; safe to bump to the latest 14.x patch release any time post-hackathon.
- **x402 v1 → v2 migration** — current packages are deprecated v1. Works fine against the facilitator today; v2 requires Next 16 and is a non-trivial migration. Filed in `FUTURE.md`.
- **npm deprecation warnings** — `uuid@9`, `@metamask/sdk@0.33.1`, etc. Noisy but functional.

---

*Keep this doc fresh when the production topology changes — network, addresses,
env vars, or operational procedures. Anyone running ops on vibe-o-matic should
be able to use this as their single reference.*
