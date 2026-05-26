# vibe-o-matic — future additions

Items intentionally **out of scope** for the hackathon build, captured here as the roadmap for what vibe-o-matic could become with full GVC team resources behind it.

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

### Integration sketch

If GVC provides a Flux-compatible LoRA:

1. **Receive the model.** Ideal: a BFL-hosted finetune (`finetune_id`). Alternative: a `.safetensors` file we self-host on Replicate / FAL / RunPod.
2. **Update `lib/vibeify-flux.ts`** to call BFL's finetune endpoint instead of `/v1/flux-2-pro`, passing `finetune_id` and `finetune_strength` (typically 0.7–0.9).
3. **Prune the prompt.** Most of `buildVibetownPrompt` in `lib/vibeify-render.ts` becomes redundant — the model already knows what a GVC character is. Keep scene + action + mood + subject description.
4. **Retire `public/gvc-faces/`** — no longer needed as input references.
5. **A/B test** with-LoRA vs current pipeline on the same prompts to validate the lift.

Estimated integration effort: **~1 day** if the LoRA is BFL-hosted, **~2–3 days** if we self-host.

### Compatibility questions to resolve with the GVC team

- Which base model is the LoRA trained on? (Flux.1 [dev], Flux.1 [pro], Flux.2 — LoRAs do not cross base models)
- Format: BFL finetune_id, or raw `.safetensors`?
- Trigger word (e.g. `gvccharacter`, `vibetown_figurine`)?
- Recommended strength range?

---

## 📋 Other future additions

### Prompt-machine integration
Pull a broader catalog of scene/action/mood combinations from the GVC prompt-machine into the preset library, expanding beyond the current six curated scenes.

### Multi-character composition
Today the pipeline handles one uploaded photo with potentially multiple subjects. A future version could let users upload multiple separate photos and compose them into a single Vibetown scene (e.g. two friends from two different photos, vibe-ified together).

### Animated outputs
Once a still render is locked, a follow-up call could animate it (subtle idle motion, scene weather, neon flicker) using a video-capable model.

### On-chain provenance
Mint each successful render as a HighKey Moments ERC-1155 token, with the source description and prompt stored as metadata — turning each pull into a permanent collectible.

### Asset pack expansion
Partner-branded scene packs (like the OpenSea neon sign added during the hackathon) for other GVC partners — each scene becoming a recognizable cross-brand moment.

---

*This roadmap is what vibe-o-matic becomes with the resources of GVC fully behind it. The hackathon build is the proof of concept; the LoRA pipeline is the production-grade version.*

