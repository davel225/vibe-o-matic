# vibe-o-matic — wiring & ownership handoff

This doc is the **single source of truth for everything the GVC team needs to
own, rotate, or verify** to take vibe-o-matic into production custody.

> **Audience:** A GVC technical lead inheriting ops. Assumed comfortable with
> Vercel, GitHub, a browser wallet, and a terminal. Not assumed to know x402,
> Coinbase CDP, or the project's internal layout.

If you read nothing else, read the [**5-minute take-over summary**](#-5-minute-take-over-summary) and the [**handoff checklist**](#-handoff-checklist).

---

## 🗺️ System wiring diagram

How a single render flows end-to-end and what every box represents:

```
                       ┌────────────────────────────────┐
                       │   GVC user (web)               │
                       │   or AI agent (HTTP POST)      │
                       └───────────────┬────────────────┘
                                       │
                          ──── HTTP ───┘
                                       │
                                       ▼
   ┌─────────────────────────────────────────────────────────────────────┐
   │   Vercel deploy — vibe-o-matic.vercel.app                           │
   │   ─ Next.js 14 (App Router)                                         │
   │   ─ ENV VARS (set in Vercel Project Settings → Environment):        │
   │       OPENAI_API_KEY            (OpenAI account)                    │
   │       BFL_API_KEY               (Black Forest Labs account)         │
   │       CDP_API_KEY_ID            (Coinbase CDP account)              │
   │       CDP_API_KEY_SECRET        (   "   ""  )                       │
   │       VIBEIFY_BYPASS_PASSWORD   (your choice — unset = disabled)    │
   └─┬───────────────┬─────────────────────────────┬──────────────────┬──┘
     │               │                             │                  │
     │ vision         │ image render                │ x402 verify+settle│ replay-protected
     ▼ ~$0.0003       ▼ ~$0.045                     ▼ free (1k/mo CDP) ▼ on-chain check
   ┌──────────┐    ┌──────────┐                ┌──────────────┐    ┌─────────────┐
   │  OpenAI  │    │ BFL Flux │                │ Coinbase CDP │    │ Public Eth  │
   │ gpt-4o-  │    │ 2 [pro]  │                │ x402 facilit.│    │ RPC         │
   │  mini    │    │          │                │              │    │ (publicnode)│
   └──────────┘    └──────────┘                └──────┬───────┘    └─────────────┘
                                                      │ ↓
                                              EIP-3009 transferWithAuth on Base
                                                      │
                                                      ▼
              ┌──────────────────────────────────────────────────────────┐
              │   Treasury wallet: 0xc93c375b022f0e707d211090d904f3266ccfce22 │
              │   ─ Receives USDC on Base mainnet (x402 USDC rail)       │
              │   ─ Receives VIBESTR on Ethereum mainnet (when allowlist │
              │     add lands — currently pending GVC action)            │
              │   ─ Same address on both chains (EVM is chain-agnostic)  │
              │   GVC team: VERIFY YOU HOLD THE PRIVATE KEY              │
              └──────────────────────────────────────────────────────────┘
```

---

## ⏱️ 5-minute take-over summary

Three things must change hands. Everything else either follows automatically or is already in your control.

1. **The GitHub repo** (`economist5/vibe-o-matic`) → transfer ownership to GVC's org.
2. **The Vercel project** (currently in `economist5`'s personal Vercel account) → transfer to GVC's Vercel team.
3. **The five env vars** in Vercel Production → rotate to GVC-owned API keys (OpenAI, BFL, CDP) + set your own bypass password.

The **treasury wallet** (`0xc93c375b…cfce22`) must be verified GVC-controlled before accepting volume — see step 4 of the handoff checklist. The **VIBESTR allowlist add** is something only the VIBESTR contract owner can perform — no developer action required from the project side.

After those swaps, the production deploy is fully yours: every dollar of every render lands in your treasury, every API call is billed to your accounts, every secret lives in your env.

---

## 📋 Inventory: every external dependency

### Env vars (live in Vercel Production)

| Name | Read by | Authenticates against | Replaceable? | Notes |
|---|---|---|---|---|
| `OPENAI_API_KEY` | `lib/vibeify-render.ts` describer & agent picker | OpenAI account | Yes — provision new at https://platform.openai.com/api-keys, swap in Vercel | gpt-4o-mini calls only; ~$0.0003 per render |
| `BFL_API_KEY` | `lib/vibeify-flux.ts` | Black Forest Labs account at https://api.bfl.ai | Yes — provision new in BFL dashboard, swap in Vercel | Flux 2 [pro] calls; ~$0.045 per render |
| `CDP_API_KEY_ID` | `@coinbase/x402` SDK in `app/api/vibeify/x402/route.ts` | Coinbase CDP facilitator | Yes — see provisioning steps below | JWT-signed; 1,000 free txs/month |
| `CDP_API_KEY_SECRET` | Same | Same | Yes | Paired with above |
| `VIBEIFY_BYPASS_PASSWORD` | `app/api/vibeify/route.ts:130` | None (server-side string match) | Yes — pick any value, set in Vercel | UNSET → test mode entirely disabled (every bypass → 403) |

### Wallets

| Address | Receives | Who controls | Where it's hardcoded |
|---|---|---|---|
| `0xc93c375b022f0e707d211090d904f3266ccfce22` | USDC on Base + VIBESTR on Ethereum | **GVC team must confirm key custody** | `lib/payment-config.ts:39` (VIBESTR split) + `:84` (USDC recipient) |
| `0x000000000000000000000000000000000000dEaD` | — (defined but unused) | Burn — N/A | `lib/payment-config.ts:24-25` (`BURN_ADDRESS`, reserved for future split) |

### Contracts & networks (read-only references — do NOT change)

| What | Address / value | Chain |
|---|---|---|
| VIBESTR ERC-20 | `0xd0cC2b0eFb168bFe1f94a948D8df70FA10257196` | Ethereum mainnet (1) |
| USDC ERC-20 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` | Base mainnet (8453) |
| Coinbase CDP x402 facilitator | `https://api.cdp.coinbase.com/platform/v2/x402` | — (off-chain service) |
| Public Ethereum RPC | `https://ethereum-rpc.publicnode.com` | Used by `lib/wallet.ts` for VIBESTR balance reads + payment verification |
| BFL Flux endpoint | `https://api.bfl.ai/v1/flux-2-pro` | — |

### Hosting & code

| What | Where | Owner today | To transfer |
|---|---|---|---|
| Live deploy | https://vibe-o-matic.vercel.app | Vercel project owned by `economist5` | Vercel → Project Settings → Advanced → Transfer Project. Or fork-and-redeploy under GVC's Vercel team. |
| Source | https://github.com/economist5/vibe-o-matic (branch `main`) | `economist5` | GitHub → Repository Settings → Transfer ownership. |
| Dev secrets | `.env.local` (gitignored, dev machine only) | Dev machine | Not transferred. GVC creates fresh `.env.local` from their own API keys per `.env.example`. |

### Other API accounts (one-off / dev-only)

| Account | Used by | Required for production? |
|---|---|---|
| Google AI Studio (`GOOGLE_API_KEY`) | `scripts/generate-body-ref.mjs` (regenerating body reference image) | **No** — dev-only utility, run once per ref refresh |

---

## 🔁 Handoff checklist

Do these in order. Each step's success is the precondition for the next.

### 1. GitHub repo transfer
- Current owner (`economist5`) → GitHub repo settings → "Transfer ownership"
- Target: a GVC GitHub org (create one if needed)
- After transfer: clone fresh, verify `main` builds (`npm install && npm run build`)
- Update the `origin` remote on any working copies that need it

### 2. Vercel project transfer (or fork-and-redeploy)
**Option A — Direct transfer** (requires GVC Vercel team on Pro+ plan):
- Vercel dashboard → vibe-o-matic project → Settings → Advanced → Transfer Project → pick GVC team

**Option B — Fork-and-redeploy** (works on any Vercel plan, cleaner cutover):
- GVC creates a new Vercel project from the now-GVC-owned GitHub repo
- Set all 5 env vars (see step 3 below) BEFORE first deploy
- After GVC deploy is verified working, point DNS / share new URL, retire old deploy

Either way, after the move the production URL should serve a `GET /api/vibeify/x402` discovery response with `network: "base"` and the correct `payTo` (treasury) address.

### 3. Provision GVC-owned API keys (and swap in Vercel)

For each row below: provision a new key in GVC's account, then update the Vercel Production env var. Trigger a redeploy after the last swap.

#### 3a. OpenAI
- https://platform.openai.com → create or use GVC's org → API Keys → Create
- Scope: `gpt-4o-mini` is all that's needed (or "All" for simplicity)
- Set as `OPENAI_API_KEY` in Vercel
- Estimated spend: ~$0.0003 per render call — negligible

#### 3b. Black Forest Labs
- https://api.bfl.ai → sign up under GVC org → API Keys → Create
- Set as `BFL_API_KEY` in Vercel
- Estimated spend: ~$0.045 per render — the heaviest cost line

#### 3c. Coinbase CDP (the x402 facilitator)
- https://portal.cdp.coinbase.com → create GVC project → API Keys → Create API Key
- Pick the **x402** scope (or "All scopes" if it's a single-app key)
- **Important:** the Key Secret is shown ONCE — copy it before closing the dialog
- Set as `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` in Vercel
- Estimated cost: free tier covers 1,000 transactions/month

#### 3d. Test-mode bypass password (your choice)
- Pick any string you want as the bypass password
- Set as `VIBEIFY_BYPASS_PASSWORD` in Vercel
- Or: leave UNSET to fully disable test mode in production

### 4. Treasury wallet verification

The same address `0xc93c375b022f0e707d211090d904f3266ccfce22` receives both:
- **USDC** on Base mainnet (every x402 paid render)
- **VIBESTR** on Ethereum mainnet (every VIBESTR paid render, once allowlist add lands)

**Before accepting volume:** confirm the GVC team holds the private key for this address. Test by signing a benign message from MetaMask connected to that address. If you don't hold the key, **stop and rotate** — update `SPLIT_RECIPIENTS[0].address` in `lib/payment-config.ts:36-40` AND `USDC_RECIPIENT` at `:84` to a GVC-controlled wallet, commit, redeploy.

### 5. VIBESTR allowlist add (one-time on-chain)

VIBESTR's `_transfer` enforces a private recipient allowlist. Add the treasury address to it so the VIBESTR rail can go live:

```
Contract:  0xd0cC2b0eFb168bFe1f94a948D8df70FA10257196 (Ethereum mainnet)
Add to allowlist:  0xc93c375b022f0e707d211090d904f3266ccfce22
```

Verification script and re-enable instructions live in [`LAUNCH.md`](./LAUNCH.md#-pending-vibestr-allowlist-add). After confirmation, two-line edit in `app/page.tsx` flips the UI from "SOON" to active.

### 6. Update stale identifiers in source

There's one stale GitHub URL embedded in the UI that points at the old repo:

- `app/page.tsx` (in `AgentEndpointCard`): the `repoBase` constant points at `https://github.com/davel225/vibe-o-matic` — update to your new org's URL after step 1.

---

## 🔒 "Don't change these" — code-level constants

These are public on-chain identifiers, not secrets. Leave them alone unless you're intentionally changing the protocol:

- `VIBESTR_ADDRESS` (`lib/payment-config.ts:13`) — VIBESTR ERC-20 mainnet address
- `USDC` mainnet contract (`lib/wallet.ts:200`) — Circle's Base USDC
- `X402_FACILITATOR_URL` (`lib/payment-config.ts:95`) — CDP's mainnet facilitator
- `RPC_URL` (`lib/payment-config.ts:70`) — public Ethereum RPC (replace with an owned RPC if you want stricter SLAs, but the default works)
- USDC chain config (`USDC_NETWORK` / `USDC_CHAIN_ID` / `USDC_NETWORK_CAIP`, `lib/payment-config.ts:79-81`)

The only intentional change you should ever make to `lib/payment-config.ts` is the treasury address (in two places — see step 4 above) or the price (`TOTAL_VIBESTR` / `USDC_PRICE_DOLLARS`).

---

## ✅ Post-handoff verification

After all swaps land, run these in order:

```bash
# 1. Homepage + discovery should both 200
curl -fsS -o /dev/null -w "homepage:    %{http_code}\n" https://vibe-o-matic.vercel.app/
curl -fsS https://vibe-o-matic.vercel.app/api/vibeify/x402
```

Expected discovery body:
```json
{"network":"base","price":"$0.69","payTo":"0xc93c375b022f0e707d211090d904f3266ccfce22","facilitator":"https://api.cdp.coinbase.com/platform/v2/x402"}
```

```bash
# 2. Treasury USDC balance on Base mainnet — should reflect your control
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

3. **End-to-end paid render** — use `scripts/test-x402-agent.mjs` from a Base mainnet wallet funded with ~$1 USDC:
   ```bash
   node scripts/test-x402-agent.mjs --help
   AGENT_PRIVATE_KEY=0x... node scripts/test-x402-agent.mjs ./agent-photo.jpg "test render"
   ```
   Expected outcome: PNG saved to disk + tx hash on Basescan + treasury USDC balance grew by $0.69.

4. **Vercel logs** — `vercel logs --since 1h` should show clean `[vibeify-x402]` settlement traces for any test calls; no auth or config errors.

If all four pass, ownership transfer is complete.

---

## 📚 Related docs

- [`LAUNCH.md`](./LAUNCH.md) — live-ops reference (smoke tests, rollback procedures, env var ladder)
- [`X402.md`](./X402.md) — external-facing agent endpoint contract
- [`FUTURE.md`](./FUTURE.md) — roadmap (LoRA integration is the headline)
- [`SUBMISSION.md`](./SUBMISSION.md) — hackathon submission narrative

---

*This doc is the contract between the developer and the GVC team. Keep it
fresh whenever a dependency moves, a key rotates, or the treasury address
changes. Anyone inheriting vibe-o-matic from here on should be able to use
this as their single take-over reference.*
