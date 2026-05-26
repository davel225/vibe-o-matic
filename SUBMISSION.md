# vibe-o-matic

> *Vibe-ify any image into a tiny, cinematic Vibetown vinyl figurine — payable in VIBESTR or USDC, callable by humans or autonomous AI agents.*

**Hackathon submission for the Good Vibes Club community.**

---

## The 30-second pitch

vibe-o-matic turns any photo into a Good Vibes Club / Vibetown vinyl figurine render in ~40 seconds. We built two completely separate surfaces for two distinct audiences:

- **GVC humans** open the web UI, connect MetaMask, pay 200 VIBESTR on Ethereum mainnet, click *Vibeify*. Every render fuels the GVC token economy (90% treasury, 10% burn).
- **Autonomous AI agents** hit `POST /api/vibeify/x402` with an image + free-text intent. Our server-side agent picks the scene/action/mood/size, runs the render, and settles a $0.69 USDC payment on Base — all in one HTTP round-trip. No API key, no signup, no human in the loop.

It's a working answer to two questions GVC cares about:

1. **How do we make Vibetown art accessible to every holder, every fan, every brand partner — at scale?** Render-on-demand from any input image, with native GVC style preservation.
2. **How do AI agents pay for and consume web services in 2026?** vibe-o-matic is one of the first production-grade x402 endpoints with native agentic interface support. OpenSea-style discoverable resources, machine-payable, no API keys.

---

## What it does — two surfaces

### Surface 1 — The web UI (the human path)
A judge or GVC holder can:
1. Open the app
2. Upload a photo *or* load any GVC token by ID (try `5618`)
3. Pick a scene from the curated catalog (Tropical Beach, Château de GODL, Neon Street with OpenSea signage, Rooftop Sunset, Lagoon Pier, Coastal Drive)
4. Pick an action emoji (🤝 Friendship, 🎉 Celebrate, 🤳 Group selfie, 🧘 Zen, 💃 Dance) and a mood (😊 😎 🔥 🌙 💪)
5. Choose orientation (square / portrait / landscape)
6. Click **Vibeify** → connect MetaMask → sign 200 VIBESTR payment → ~40s later, a Vibetown render of themselves

The web UI is single-purpose: VIBESTR only, manual scene/action/mood selection, no toggles or modes. Clean human flow.

### Surface 2 — The x402 agent endpoint (the autonomous AI path)
External AI agents hit `POST /api/vibeify/x402` with two body params: an image and a free-text intent. Our server-side picker reads the photo + intent and chooses scene/action/mood/size from the curated catalog. The render proceeds, the agent's picks come back in the response (with reasoning), and a $0.69 USDC payment settles on Base — all in one HTTP round-trip with the EIP-3009 signature in the `X-PAYMENT` header.

A Node script (`scripts/test-x402-agent.mjs`) demonstrates the full flow without a browser:

```bash
AGENT_PRIVATE_KEY=0x... node scripts/test-x402-agent.mjs ./photo.jpg "rockstars at an after-party"
```

The script signs the EIP-3009 USDC authorization, hits our endpoint, and saves the rendered PNG to disk. **This is the future of how AI agents pay for services on the web** — no API key, no signup, no human in the loop.

---

## What's technically interesting

### 🧠 Vision-first describer (privacy + identity preservation)
Source photo pixels **never reach the image generator**. We use gpt-4o-mini vision to convert the photo into a structured text description (hair, facial hair, clothing, fine details — but never face geometry), then pass *only* that text to Flux 2 [pro] along with our GVC face-structure reference set. Result: identity preserved (clothing, accessories, hair, beard) but face anatomy comes from canonical GVC templates, not the source photo.

### 🎨 Multi-reference Flux 2 pipeline
Each render sends 7 reference images to Flux: 1 body T-pose template, 4 curated face references (showing different expressions + bearded vs clean-shaven structure), and up to 2 scene-specific backgrounds. The model has visual exemplars of what a GVC character looks like — not just text rules.

### 💸 Two audiences, two rails — and they never overlap on purpose

| Audience | Surface | Network | Asset | Price |
|---|---|---|---|---|
| **GVC humans** | The web UI (vibe-o-matic.com) | Ethereum mainnet | $VIBESTR ERC-20 | 200 VIBESTR (90/10 treasury/burn) |
| **Autonomous AI agents** | `POST /api/vibeify/x402` | Base mainnet | USDC | $0.69 |

This split is intentional, not accidental:

- **Humans should pay GVC's currency.** Every human render creates buying pressure on $VIBESTR — treasury accumulates, burn destroys, both reinforce the token. Mixing in a USDC option would leak value out of the GVC economy.
- **AI agents need a protocol-standard currency.** x402 was designed around USDC because that's the stable, widely-supported, EIP-3009-ready stablecoin every facilitator already knows about. VIBESTR isn't in that compatibility set.
- **Result:** the web UI is a clean VIBESTR-only flow (no rail toggle, no choice paralysis). The agent endpoint at `/api/vibeify/x402` is a separate, machine-callable URL with its own contract documented in [`X402.md`](./X402.md). Two surfaces, two audiences, zero overlap.

### 🤖 First-class agentic interface (the headline feature)
The `/api/vibeify/x402` endpoint accepts two modes:
- **Explicit**: caller provides scene/action/mood/size
- **Agent mode**: caller sends just `agentMode=1` + optional intent; server-side gpt-4o-mini picks the params from the curated catalog

The agent ALWAYS picks from a curated allowlist (never free-form scene text), keeping the renderer's MP budget and prompt structure predictable. If the picker returns an unknown id, we gracefully fall back to sensible defaults — caller paid USDC, deserves *some* render.

This is the difference between "an API that happens to charge money" and "a service designed for autonomous AI agents from day one."

### 🎯 OpenSea brand integration
The Neon Street scene includes a custom-built neon OpenSea logo as one of the storefront signs, using OpenSea's exact brand hex codes from their style guide (Sea Blue #2081E2, Marina Blue #15B2E5, Aqua #2BCDE4, Fog #E5E8EB). Every render at that scene puts the OpenSea mark in the background — a small visual nod to a community-defining marketplace.

---

## Try it (live demo)

| | |
|---|---|
| **Live URL** | https://vibe-o-matic.vercel.app |
| **Sample GVC token to render** | `5618` |
| **x402 endpoint (machine-callable)** | `POST /api/vibeify/x402` |
| **x402 discovery (GET)** | `GET /api/vibeify/x402` → returns price + facilitator URL |
| **Full agent contract docs** | [`X402.md`](./X402.md) |
| **Source code** | https://github.com/davel225/vibe-o-matic |
| **Test wallet (for judges to fund)** | (none required — judges can use their own; test-mode toggle available) |

---

## The numbers

### Cost per render

| Component | Cost |
|---|---|
| gpt-4o-mini vision describer | ~$0.0001 |
| gpt-4o-mini agent picker (if agent mode) | ~$0.0002 |
| Flux 2 [pro] generation | ~$0.045 |
| **Total compute** | **~$0.046** |
| Charged to caller (USDC) | $0.69 |
| **Margin per call** | **~$0.64** |

### Latency

| Stage | Time |
|---|---|
| Discovery 402 | ~50ms |
| EIP-3009 sign (client-side) | 1s (MetaMask) |
| Facilitator verify | ~2s |
| Describer | ~3s |
| Flux render (submit + poll) | ~30–40s |
| Facilitator settle | ~2s |
| **Total end-to-end** | **~35–55s** |

### Quality
Across N renders of the same input, we see ~90% "on-spec, judge-ready" outputs. The remaining ~10% have stochastic artifacts (occasional phantom mouth inside a beard, occasional nose regression, occasional skin-tone drift) that no amount of prompt engineering will fully eliminate against Flux's strong priors. **This is exactly the gap a GVC-trained LoRA would close.**

---

## The future: GVC LoRA partnership (the production upgrade)

The hackathon build is a proof of concept. The production-grade version is a single architectural change: **swap our hand-tuned 200-line prompt for a LoRA trained on the GVC character set**.

### Why it matters

Today, our pipeline coerces a general-purpose image model (Flux 2 [pro]) into producing GVC-style output through extensive prompt engineering. Every "no nose" / "bearded characters have no mouth" / "olive skin is warm beige" rule exists because the base model's defaults pull elsewhere. The model is always *fighting its priors* to render canonical Vibetown.

A LoRA trained on GVC characters **bakes those defaults into the model weights**, eliminating the fight. What this unlocks:

| Today (reference-image pipeline) | With a GVC LoRA |
|---|---|
| ~200-line prompt fighting model priors | ~10-line prompt; model already knows GVC |
| Stochastic phantom-mouth / nose / skin-tone artifacts | Disappear at the weights level |
| 7 reference images per call | Could drop to 1–2 (scene only) |
| Identity preserved via describer (kept) | Same |
| ~$0.045 per render | Lower (fewer ref images uploaded) |

### Integration sketch (1–3 days of work once we have the LoRA)
1. Receive a Flux-compatible LoRA from the GVC team (BFL-hosted `finetune_id` is the easiest path; `.safetensors` is also fine via Replicate/FAL self-host)
2. Update `lib/vibeify-flux.ts` to call BFL's finetune endpoint instead of `/v1/flux-2-pro`, passing `finetune_id` and `finetune_strength`
3. Prune most of `lib/vibeify-render.ts`'s prompt — the model already knows what a GVC character is
4. Retire `public/gvc-faces/` (no longer needed as input references)
5. A/B test with-LoRA vs current pipeline on the same inputs

Full roadmap, integration plan, and compatibility questions in [`FUTURE.md`](./FUTURE.md).

### The narrative we want judges to hear
**The hackathon build is what one person can ship in a few days with off-the-shelf models. With the resources of GVC fully behind it — a LoRA + brand asset access + community endorsement — vibe-o-matic becomes the canonical "make me a Vibetown character" service for every GVC holder, every brand partner, every AI agent that wants to mint or display GVC-style art.**

---

## Tech stack

- **Frontend**: Next.js 14 App Router, React, TypeScript, Tailwind, Framer Motion
- **Image generation**: Black Forest Labs FLUX.2 [pro] (multi-reference editing)
- **Vision**: OpenAI gpt-4o-mini (describer + agent picker)
- **Blockchain**: viem (wallet + chain interactions)
- **Payments**: x402 (USDC on Base) + custom VIBESTR ERC-20 verification on Ethereum mainnet
- **Hosting**: Vercel

---

## Repo guide for judges who want to dive in

| File | What's inside |
|---|---|
| `app/page.tsx` | Web UI — three input panels, two payment rails, debug panel |
| `app/api/vibeify/route.ts` | VIBESTR rail entry point (verifies on-chain payment, delegates render) |
| `app/api/vibeify/x402/route.ts` | x402/USDC rail entry point (supports agent mode) |
| `lib/vibeify-render.ts` | Shared describe → prompt → Flux render pipeline |
| `lib/vibeify-agent.ts` | Server-side preset picker (gpt-4o-mini vision + JSON mode) |
| `lib/vibeify-describe.ts` | gpt-4o-mini vision describer (no source pixels reach Flux) |
| `lib/vibeify-flux.ts` | Flux 2 [pro] async submit + poll client |
| `lib/vibeify-references.ts` | Loads body + face + scene reference images |
| `lib/presets.ts` | SCENE / ACTION / MOOD catalogs (shared between UI and agent) |
| `lib/payment-config.ts` | VIBESTR + USDC pricing, splits, network config |
| `lib/wallet.ts` | MetaMask + x402-fetch wrapper |
| `X402.md` | Full external-facing x402 API contract |
| `FUTURE.md` | LoRA roadmap + post-hackathon plans |
| `LAUNCH.md` | Pre-launch checklist (testnet → mainnet flip) |

---

## Why we're proud of this

1. **It's actually shipping**, not just a demo video. Both payment rails work end-to-end on real networks (Ethereum mainnet for VIBESTR, Base Sepolia for USDC during the hackathon — flipping to Base mainnet at launch).
2. **The agentic x402 flow is a genuine first-of-kind**. We're not just "an API behind Stripe." We're a service that an autonomous AI agent can discover, agree to a price with, pay for, and consume — in one HTTP round-trip. That's the next decade of web monetization.
3. **The OpenSea integration is a love letter to the marketplace** that built this whole NFT ecosystem. Brand-correct neon signage, exact hex codes, baked into one of the canonical scenes.
4. **The future is honestly costed and scoped**. We're not handwaving — `FUTURE.md` is a partnership proposal with a 1–3 day integration estimate.
5. **Built with Claude Code**. Every line of code in this repo was paired between a human and Claude. The development log itself is a demonstration of human + AI agent collaboration — the same pattern we're enabling for *consumers* of vibe-o-matic.

---

*Made for the Good Vibes Club community by [your name] · [your X handle] · [contact].*
