# VIBESTR builder-integration question for the GVC team

**From**: vibe-o-matic (Good Vibes Club hackathon submission)
**TL;DR**: One specific ask — please add `0xc93c375b022f0e707d211090d904f3266ccfce22` to VIBESTR's recipient allowlist so we can accept VIBESTR as payment.

## The discovery

We built a `transfer(treasury, 99 * 10^18 VIBESTR)` payment flow for vibe-o-matic and hit `InsufficientAllowance` reverts (`0x2f352531`). After probing, we found the cause: **VIBESTR's `_transfer` has a private internal recipient allowlist.** Transfers to addresses on the list succeed; transfers to any other address revert with `InsufficientAllowance` regardless of sender balance or allowance state.

Concrete proof:

| Tx | Sender | Recipient | Amount | Result |
|---|---|---|---|---|
| [`0xe3c0eb…d8805`](https://etherscan.io/tx/0xe3c0eb968884c637e4fa99a0dadc280510f8808ce262d0067c46cf64599d8805) | `0xac1e7b…44793` | `0x6b749c…22b4bd` (GVC game wallet, EOA) | 800 VIBESTR | ✅ succeeds |
| simulated, identical sender + token + function | `0xac1e7b…44793` | `0xc93c37…cfce22` (vibe-o-matic treasury, EOA) | 99 VIBESTR | ❌ reverts `InsufficientAllowance` |

Both recipients are vanilla EOAs (no bytecode), so the difference can only be an internal allowlist check. We probed for a public getter (`isApprovedTarget`, `approvedRecipients`, `isWhitelisted`) — none exist on the contract.

## The ask

**Can `0xc93c375b022f0e707d211090d904f3266ccfce22` be added to VIBESTR's recipient allowlist?**

If yes, our entire payment flow works as-is with zero code changes — same vanilla ERC-20 `transfer()` we're already calling. If you need any of the following from us first, happy to provide:
- Verification that we control the address (we can sign a message)
- A short description of the use case (charging GVC holders 99 VIBESTR per Vibetown vinyl-figurine render of their photo, 100% to that treasury)
- Anything else

If there's a **self-service mechanism** for builders to register a recipient (or a public list / form / Discord channel for these requests), even better — that'd unlock every future builder, not just us.

## Why this matters for the broader ecosystem

This appears to be the missing piece for VIBESTR-as-payment in builder apps. We checked [`brydisanto/gvc-builder-kit`](https://github.com/brydisanto/gvc-builder-kit) — the official kit treats VIBESTR exclusively as read-only DexScreener data (price/volume/balance). No transfer/payment patterns documented. So the answer you give us could become the basis for a "How to accept VIBESTR" section of the kit — every future builder benefits.

## Repro (optional, for the contract dev)

```js
import { createPublicClient, http, parseAbi } from "viem";
import { mainnet } from "viem/chains";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com"),
});
const abi = parseAbi(["function transfer(address,uint256) returns (bool)"]);
const VIBESTR = "0xd0cC2b0eFb168bFe1f94a948D8df70FA10257196";
const USER = "0xac1e7beae9fcf9b4f294cd534cd0b1ae1ef44793";

// Works:
await client.simulateContract({ address: VIBESTR, abi, functionName: "transfer",
  args: ["0x6b749c62d907d7ef66e9438e231070070e22b4bd", 99n * 10n ** 18n], account: USER });

// Reverts InsufficientAllowance (0x2f352531):
await client.simulateContract({ address: VIBESTR, abi, functionName: "transfer",
  args: ["0xc93c375b022f0e707d211090d904f3266ccfce22", 99n * 10n ** 18n], account: USER });
```

## Related findings (for completeness)

We also tested `increaseTransferAllowance(amount)` — it reverts with `InvalidTarget()` (`0x5a91834f`) for any caller / any amount, suggesting that function is restricted to internal callers (hooks / Seaport / factory). So self-allowance isn't the user-facing escape hatch either; the allowlist appears to be the only path.

Thanks 🙏 — even a one-line "yes, added" or "no, here's the real path" unblocks our submission.
