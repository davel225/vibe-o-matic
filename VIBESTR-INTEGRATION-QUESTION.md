# VIBESTR builder-integration question for the GVC team

**From**: vibe-o-matic (Good Vibes Club hackathon submission)
**Re**: Accepting VIBESTR as payment for a third-party service
**Wallet for testing**: `0xac1e7beae9fcf9b4f294cd534cd0b1ae1ef44793` (holds 152,303 VIBESTR)
**Intended treasury recipient**: `0xc93c375b022f0e707d211090d904f3266ccfce22`

## What we're building

vibe-o-matic is a hackathon project that turns user photos into Vibetown vinyl-figurine renders. We want **GVC holders to pay 99 VIBESTR per render**, with the full amount going to the GVC treasury — every render = buying pressure on $VIBESTR.

## What we found when implementing the payment flow

Our app calls `transfer(treasury, 99 * 10^18)` from the user's MetaMask. We expected vanilla ERC-20 behavior. Instead:

1. **`transfer()` reverts with `InsufficientAllowance()`** (selector `0x2f352531`).
   This made sense — VIBESTR's ABI shows a self-allowance system (`getTransferAllowance`, `increaseTransferAllowance`) that we hadn't seen before. So we wired our flow to call `increaseTransferAllowance` first.

2. **`increaseTransferAllowance(uint256)` then reverts with `InvalidTarget()`** (selector `0x5a91834f`) for any amount, called from a normal user wallet that holds VIBESTR.

Both confirmed via direct `simulateContract` calls against the deployed implementation (`0x0f8DEfAe8f0aad5fdcdb813ff04434a55eb9a260`) using the holder's address as the simulated caller.

### Other custom errors in the contract that suggest the intended design

`OnlyHook`, `SeaportIsDisabled`, `SeaportListingAlreadyExists`, `Permit2AllowanceIsFixedAtInfinity`, `NFTPriceTooLow`, `NoETHToTwap` — these point at a strategy token built for Seaport / Permit2 / hook-based flows rather than free p2p transfers.

### Builder-kit cross-check

We also checked [`brydisanto/gvc-builder-kit`](https://github.com/brydisanto/gvc-builder-kit) — the official builder kit treats VIBESTR exclusively as a **read-only data source** (DexScreener proxy for price/liquidity, balance-check badges). Zero references to `increaseTransferAllowance`, `getTransferAllowance`, Permit2, Seaport, or any other transfer/payment pattern. The kit's prompt cheatsheet only suggests display-side apps like "show the VIBESTR price" and "show my wallet's VIBESTR balance." So we don't think we're missing a documented integration path — it appears none has been published yet, which is exactly what this question is asking about.

## What we'd love guidance on

1. **Is direct user-initiated `transfer()` of VIBESTR to arbitrary recipients ever expected to work?** Or is the contract intentionally non-transferable outside of marketplace/hook flows?
2. **If transfers are gated by an approved-targets allowlist, can our treasury `0xc93c375b022f0e707d211090d904f3266ccfce22` be added?** Or is there a self-service registration pattern we're missing?
3. **Is the intended payment integration through Seaport / Permit2 / a custom hook contract?** Pointers to any builder docs or example integrations would unblock us immediately.
4. **Is there a separate ERC-20 we should use for builder integrations** (e.g. a "GVC bucks" or freely-transferable payment token), with VIBESTR reserved for in-protocol strategy operations?

## Why this matters for the submission

The hackathon thesis is *"humans pay GVC's currency for GVC-style art, every render fuels the GVC economy."* VIBESTR-as-payment is the on-thesis choice. Without it, we fall back to USDC (which works fine via x402, our agent rail) — but that's value leaking out of the GVC token economy, which is exactly what we wanted to avoid.

A 30-second answer from anyone on the contract team unblocks us — even "VIBESTR isn't meant to be used this way, use $X instead" is a great answer. We'll happily integrate whatever the right path is.

Thanks 🙏

---
*Repro of the failing calls (paste into any node REPL with viem):*

```js
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com"),
});
const abi = parseAbi([
  "function increaseTransferAllowance(uint256)",
  "function transfer(address,uint256) returns (bool)",
]);
const USER = "0xac1e7beae9fcf9b4f294cd534cd0b1ae1ef44793";
const TREASURY = "0xc93c375b022f0e707d211090d904f3266ccfce22";
const VIBESTR = "0xd0cC2b0eFb168bFe1f94a948D8df70FA10257196";

// Both of these revert:
await client.simulateContract({
  address: VIBESTR, abi,
  functionName: "increaseTransferAllowance",
  args: [99n * 10n ** 18n],
  account: USER,
}); // → InvalidTarget (0x5a91834f)

await client.simulateContract({
  address: VIBESTR, abi,
  functionName: "transfer",
  args: [TREASURY, 99n * 10n ** 18n],
  account: USER,
}); // → InsufficientAllowance (0x2f352531)
```
