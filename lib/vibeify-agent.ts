import OpenAI from "openai";
import {
  ACTION_PRESETS,
  MOOD_PRESETS,
  SCENE_PRESETS,
  findAction,
  findMood,
  findScene,
  type VibeSize,
} from "./presets";

/**
 * Agentic param picker for the x402 endpoint.
 *
 * Given the source image (buffer + mime) and a free-text intent, this calls
 * gpt-4o-mini vision in JSON mode to pick:
 *   - one scene preset id
 *   - one action preset id
 *   - one mood preset id
 *   - a size (square / portrait / landscape)
 *
 * The agent returns IDs only (never free-form scene text), so the renderer's
 * MP budget and prompt structure stay predictable. The IDs are resolved here
 * back to full preset strings before being handed to `generateVibetown`.
 *
 * If the agent returns an unknown id, we fall back to sensible defaults
 * (tropical-beach / friendship / joyful / square) rather than failing —
 * the x402 caller has already paid USDC and deserves *some* render.
 *
 * Why gpt-4o-mini? Same model as the describer, already installed, already
 * keyed via OPENAI_API_KEY, ~$0.0002 per call.
 */

export type PickedVibeParams = {
  scene: string;
  action: string;
  mood: string;
  size: VibeSize;
  sceneBgFilenames: string[];
  /** Diagnostics — surfaced in the x402 response so the caller knows why. */
  agentReasoning: string;
  /** The raw IDs the agent picked (for client-side display / debugging). */
  agentPicks: {
    sceneId: string;
    actionId: string;
    moodId: string;
    size: VibeSize;
  };
};

const VALID_SIZES = new Set<VibeSize>([
  "1024x1024",
  "1024x1536",
  "1536x1024",
]);

function buildSystemPrompt(): string {
  const sceneList = SCENE_PRESETS.map(
    (p) => `  - ${p.id} (${p.emoji} ${p.label})`
  ).join("\n");
  const actionList = ACTION_PRESETS.map(
    (p) => `  - ${p.id} (${p.emoji} ${p.label}): ${p.prompt}`
  ).join("\n");
  const moodList = MOOD_PRESETS.map(
    (p) => `  - ${p.id} (${p.emoji} ${p.label}): ${p.prompt}`
  ).join("\n");

  return `You are the vibe-o-matic agentic picker. The caller is an external agent (or human) that paid USDC for a Vibetown vinyl-figurine render. They sent us a source photo and a free-text intent. Your job: pick the single best combination of (scene, action, mood, size) from the curated preset catalog below.

Return ONLY a JSON object with these exact keys:
{
  "sceneId": "<one of the scene ids>",
  "actionId": "<one of the action ids>",
  "moodId": "<one of the mood ids>",
  "size": "1024x1024" | "1024x1536" | "1536x1024",
  "reasoning": "<one short sentence explaining the pick>"
}

SCENES (pick exactly one sceneId):
${sceneList}

ACTIONS (pick exactly one actionId):
${actionList}

MOODS (pick exactly one moodId):
${moodList}

SIZE selection rules:
  - 1024x1024 (square): default, single subject portraits, ambiguous compositions
  - 1024x1536 (portrait): tall framing — single full-body subject, vertical scenes
  - 1536x1024 (landscape): wide framing — two or more subjects side by side, scenic backdrops, group shots

Hard constraints:
  - Return ONLY valid JSON. No prose. No code fence.
  - Every id you return MUST be from the lists above — case sensitive, kebab-case.
  - reasoning ≤ 120 chars.
  - If the intent text contradicts what you see in the photo, prefer what is in the photo (the intent may be aspirational or vague).
  - If intent is empty, choose what best fits the photo's apparent mood and subject count.`;
}

export async function pickVibeParams(
  image: { buffer: Buffer; mime: string },
  intent: string,
  apiKey: string
): Promise<PickedVibeParams> {
  const openai = new OpenAI({ apiKey });
  const dataUrl = `data:${image.mime};base64,${image.buffer.toString("base64")}`;

  const userText = intent.trim()
    ? `Caller intent: ${intent.trim()}\n\nPick the best preset combination for the attached photo + intent.`
    : `No intent text was supplied. Pick the best preset combination based on the attached photo alone.`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    max_tokens: 300,
    messages: [
      { role: "system", content: buildSystemPrompt() },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
        ],
      },
    ],
  });

  const raw = completion.choices?.[0]?.message?.content?.trim();
  if (!raw) {
    throw new Error("Agent picker returned no content.");
  }

  let parsed: {
    sceneId?: string;
    actionId?: string;
    moodId?: string;
    size?: string;
    reasoning?: string;
  };
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(
      `Agent picker returned invalid JSON: ${(e as Error).message} — raw=${raw.slice(0, 200)}`
    );
  }

  // Resolve with graceful fallbacks — the caller has already paid, so render
  // *something* rather than 502 on a single bad id.
  const sceneHit = findScene(parsed.sceneId) ?? SCENE_PRESETS[0];
  const actionHit = findAction(parsed.actionId) ?? ACTION_PRESETS[0];
  const moodHit = findMood(parsed.moodId) ?? MOOD_PRESETS[0];
  const size: VibeSize = VALID_SIZES.has(parsed.size as VibeSize)
    ? (parsed.size as VibeSize)
    : "1024x1024";

  return {
    scene: sceneHit.scene,
    action: actionHit.prompt,
    mood: moodHit.prompt,
    size,
    sceneBgFilenames: sceneHit.bgImages ?? [],
    agentReasoning: parsed.reasoning ?? "(no reasoning returned)",
    agentPicks: {
      sceneId: sceneHit.id,
      actionId: actionHit.id,
      moodId: moodHit.id,
      size,
    },
  };
}
