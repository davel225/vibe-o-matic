# vibe-o-matic — future additions

Items intentionally **out of scope** for the hackathon build, captured here as the roadmap for what vibe-o-matic could become with GVC team resources behind it.

Stewardship of the project transfers to the GVC team post-hackathon (see [`WIRING.md`](./WIRING.md) for the per-dependency handoff guide). The items below describe directions the project could take — actual implementation, hosting decisions, and prioritization are GVC's call. The original author is happy to consult on any of these items but is not the implementer once the keys change hands.

---

## 🎯 Headline opportunity: GVC LoRA integration

**The biggest single-step quality upgrade available to this project is replacing reference-image-driven style guidance with a Low-Rank Adaptation (LoRA) model trained directly on GVC characters.**

### Why this matters

The hackathon build coerces a general-purpose image model (Flux.2 [PRO]) into producing GVC-style figurines through a heavily engineered, ~200-line text prompt and seven reference images per call. It works — but the model is always *fighting its priors* to render the canonical Vibetown look:

- No nose, no eyebrows
- One simple curved mouth (or zero, replaced by beard mass)
- Matte vinyl 3D figurine proportions
- Specific palette and material language

Every guardrail in the current prompt exists because the base model's defaults pull elsewhere. The prompt does extensive rule-stating ("FACE STRUCTURE OVERRIDES SCENE AESTHETIC", "OLIVE = WARM HUMAN TONE, NEVER GREEN", "the facial hair REPLACES the mouth entirely", etc.) precisely because those rules have to win against the model's learned defaults on every single render.

A LoRA trained on the GVC character set **bakes those defaults into the model weights**, eliminating the fight.

### What it unlocks

| Today (reference-image pipeline) | With a GVC LoRA |
|---|---|
| Style is *suggested* by ref images on every call → stochastic | Style is *baked into weights* → consistent across seeds |
| ~80% of the prompt is rules fighting model priors | The model *learns* GVC defaults — most rules become superfluous |
| Saturated face refs occasionally leak skin color | No face refs needed → leak vector removed |
| Bearded-character mouth artifacts recur with seed variance | LoRA learns the canonical bearded structure once |
| Up to 9 reference images per call | Drop to 1–2 (scene only) → faster + cheaper |
| Prompt is ~200 lines | Could shrink to ~10–15 lines |

The identity pipeline (gpt-4o-mini describing the uploaded photo) still runs — **the LoRA provides style, the describer provides identity**. They're complementary.

### Integration approach (GVC-led)

If GVC chooses to pursue a LoRA upgrade, the technical path is short. Integration, hosting, and rollout decisions belong to the GVC team — the shape of the work, for reference:

1. **Source the LoRA.** Either a BFL-hosted finetune (`finetune_id`, simplest path — no extra hosting to own) or a `.safetensors` file self-hosted on Replicate / FAL / RunPod (more flexibility, more infrastructure ownership).
2. **Swap the renderer call.** `lib/vibeify-flux.ts` currently calls `/v1/flux-2-pro`. Point it at the relevant finetune endpoint instead, passing `finetune_id` and `finetune_strength` (typically 0.7–0.9).
3. **Prune the prompt.** Most of `buildVibetownPrompt` in `lib/vibeify-render.ts` becomes redundant once the model knows GVC at the weights level. Keep scene + action + mood + subject description; drop the no-nose / facial-hair / skin-tone guardrails.
4. **Retire face references.** `public/gvc-faces/` is no longer needed as renderer input.
5. **A/B test** with-LoRA vs current pipeline on the same prompts to validate the lift before fully cutting over.

### Due diligence checklist (pre-integration)

Items the GVC team should confirm or decide before kicking off the integration work:

- [ ] **Base model alignment.** Which base is the LoRA trained on (Flux.1 [dev], Flux.1 [pro], Flux.2)? LoRAs do not cross base models — if the LoRA targets a different base than our current Flux 2 [pro] pipeline, either retrain to align or commit to that base's rendering pipeline for the rest of the stack.
- [ ] **Artifact format.** BFL-hosted `finetune_id` vs raw `.safetensors`? Each has different hosting + cost implications. Pick before sourcing.
- [ ] **Trigger word.** Most LoRAs expect a specific phrase (e.g. `gvccharacter`, `vibetown_figurine`) in the prompt to activate the style. Confirm what the trained word is so the prompt template can include it.
- [ ] **Recommended strength range.** Under-strength means the pipeline still fights priors; over-strength can over-saturate. Confirm the trainer's recommended `finetune_strength` band.
- [ ] **Cost delta.** Compare cost-per-call with the LoRA endpoint vs the current Flux 2 [pro] flat rate. Finetune endpoints sometimes price differently — confirm budget impact.
- [ ] **A/B benchmark set.** Is there a curated set of GVC-style outputs against which to evaluate the LoRA's lift? If not, assemble ~50 reference renders before cutover.
- [ ] **Face reference fallback.** Decide whether `public/gvc-faces/` stays in the repo as a fallback (in case the LoRA endpoint is briefly unavailable) or is retired entirely.
- [ ] **Billing ownership.** Which GVC account holds the BFL or self-host bill once the LoRA is live? Coordinate with the WIRING.md key-rotation step.
- [ ] **Rollout plan.** Big-bang cutover, fractional A/B rollout, or canary at a single rail (e.g. agent endpoint first)?

---

## ⏳ VIBESTR rail activation

The second human-side payment rail is built end-to-end and gated entirely on a single on-chain action: **a whitelisted VIBESTR recipient address being put in place** for the contract's `_transfer` allowlist. While the allowlist add is pending, the web UI shows VIBESTR as a `SOON` pill next to the active USDC option, and humans pay via USDC.

### What's already production-ready

- `payVibestrSplit` builds the multi-transfer payment client-side
- `verifyPayment` validates the on-chain receipts server-side
- The wallet pill in the header displays a live VIBESTR balance regardless of which chain the user's wallet is currently on
- Server-side replay protection on tx hashes (in-memory today; move to KV before high volume — see [`LAUNCH.md`](./LAUNCH.md))

### What's needed to flip it live

1. A whitelisted VIBESTR recipient address is added to the contract's `_transfer` allowlist by a VIBESTR contract owner
2. A two-line edit in `app/page.tsx` removes the `SOON` pill and re-wires the click handler

That's it — no further code changes required. Verification script + exact re-enable steps live in [`LAUNCH.md`](./LAUNCH.md#-pending-vibestr-allowlist-add).

### Why this lives in the future doc

The hackathon build ships humans a working rail (USDC) and demonstrates the VIBESTR pipeline end-to-end via the test-mode bypass. The native-coin rail goes live the moment a whitelisted recipient is in place — entirely outside the hackathon scope, but a one-action distance from production.

---

## 🔗 ERC-8257 tool registry listing

[**ERC-8257**](https://www.8257.ai/) ([ProjectOpenSea](https://github.com/ProjectOpenSea)) is OpenSea's onchain registry for AI agent tools — a discovery layer specifically designed to complement x402. Their own positioning calls it *"`403` to x402's `402`."* Same contract on Ethereum + Base mainnet: `0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1`.

vibe-o-matic is textbook ERC-8257 material: an already-payable HTTP endpoint targeting autonomous AI agents on Base, with predictable per-call economics. Listing it in the registry makes vibe-o-matic discoverable to every agent that already speaks ERC-8257 — the same agent population x402 was designed for.

### Integration sketch (GVC-led, post-hackathon)

Whoever inherits the project would need to:

1. **Author the tool manifest.** A JSON descriptor served at `/.well-known/ai-tool/vibeify.json` per the ERC-8257 spec. Describes the endpoint, the access predicate, and the agent-facing schema.
2. **Deploy an `IAccessPredicate` contract on Base.** Three functions:
   - `hasAccess(address agent) → bool`
   - `getRequirements() → bytes` (declares the access requirements machine-readably)
   - `name() → string`

   The predicate's logic is custom — for vibe-o-matic, the simplest path is a permissive `hasAccess() → true` that defers gating to the existing HTTP-layer x402 verification. A more sophisticated predicate could verify an on-chain x402 payment proof directly, eliminating the redundant HTTP step.
3. **Register the tool** via the OpenSea SDK: `npx @opensea/tool-sdk register --metadata <manifest-url> --network base`. One-time tx; costs Base mainnet gas.
4. **Add server-side SIWE header acceptance.** ERC-8257 callers send a SIWE (Sign-In-With-Ethereum) `Authorization` header. The existing `/api/vibeify/x402` route would learn to accept either the current `X-PAYMENT` (x402) header OR a SIWE header (ERC-8257), running the same render pipeline in both cases.

Estimated effort: **~2-3 working days** for a developer comfortable with Solidity + TypeScript + Base mainnet.

### Why this is a strong follow-up

The narrative connection is unusually clean:

- vibe-o-matic already ships an **OpenSea brand cameo** in the Neon Street scene
- vibe-o-matic already runs **on Base** with x402 USDC settlement
- vibe-o-matic is **already callable by autonomous AI agents**

Listing in ERC-8257 closes the loop: same parent ecosystem (OpenSea), same chain (Base), same audience (autonomous AI agents). The project becomes a real example of "x402-payable + ERC-8257-discoverable" — the canonical pattern these two protocols were designed to enable together.

### Due diligence checklist (pre-integration)

- [ ] Confirm ERC-8257's manifest schema (full JSON shape) from [the spec page](https://www.8257.ai/spec)
- [ ] Decide between the simple-permissive predicate (defer to HTTP-layer x402) vs an x402-aware on-chain predicate (verify payment receipts before the HTTP call)
- [ ] Confirm the SIWE header format ERC-8257 expects, and the latency budget for the per-request predicate re-check (currently estimated at ~100-200ms via standard Base RPC)
- [ ] Verify there are no registry-side fees on registration or per-call (none documented today)
- [ ] Decide whether to keep `/api/vibeify/x402` dual-protocol (both headers accepted) or fork a second route at `/api/vibeify/8257` for cleaner separation
- [ ] Choose a canonical tool name and reserve any related identifiers before registration

---

## 📋 Other future additions

### Prompt-machine integration
Pull a broader catalog of scene/action/mood combinations from the GVC prompt-machine into the preset library. The current catalog is 6 scenes / 7 actions / 8 moods = 336 server-side picker combinations (× 3 aspect ratios = 1,008). A prompt-machine sync could 10× that without changing the agent contract.

### Agent SDK / language clients
The current agent integration surface is two things: a documented HTTP shape (`X402.md`) and one example Node CLI (`scripts/test-x402-agent.mjs`). Both are great for technical agents, but a per-language SDK (Python, Go, TypeScript) with `agentMode` as a single function call would lower the barrier further. The Node script already shows the canonical flow (discovery → balance preflight → EIP-3009 sign → 402-then-retry → image save) — porting it to two or three languages is straightforward.

### Multi-character composition
Today the pipeline handles one uploaded photo with potentially multiple subjects. A future version could let users upload multiple separate photos and compose them into a single Vibetown scene (e.g. two friends from two different photos, vibe-ified together).

### Animated outputs
Once a still render is locked, a follow-up call could animate it (subtle idle motion, scene weather, neon flicker) using a video-capable model.

### On-chain provenance
Mint each successful render on-chain as a token (ERC-20 or ERC-1155) tied to the source description + prompt as metadata — turning each pull into a recorded artifact. Choice of standard, contract, and minting venue would be GVC's call.

### Asset pack expansion
Partner-branded scene packs (like the OpenSea neon sign added during the hackathon) for other GVC partners — each scene becoming a recognizable cross-brand moment.

---

*This roadmap is what vibe-o-matic becomes with the resources of GVC fully behind it. The hackathon build is the proof of concept; the LoRA pipeline is the production-grade version.*
