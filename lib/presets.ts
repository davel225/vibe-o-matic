/**
 * Shared scene / action / mood presets for vibe-o-matic.
 *
 * Single source of truth used by:
 *   - app/page.tsx (web UI emoji pickers)
 *   - lib/vibeify-agent.ts (server-side gpt-4o-mini agent that picks presets
 *     from a free-text intent when the x402 endpoint runs in agent mode)
 *
 * Each preset has a stable `id` (kebab-case, never displayed to humans) that
 * the agent returns; the server resolves the id back to the full prompt text
 * before passing it to the renderer. This keeps free-form text out of the
 * agentic path and lets us version preset wording without changing the API.
 */

export type ScenePreset = {
  /** Stable machine id (e.g. "neon-street"). */
  id: string;
  /** Display emoji. */
  emoji: string;
  /** Short human label. */
  label: string;
  /** Full prompt text sent to the renderer. */
  scene: string;
  /** Filenames (in public/scenes/) of background reference images. */
  bgImages?: string[];
};

export const SCENE_PRESETS: ScenePreset[] = [
  {
    id: "tropical-beach",
    emoji: "🏖️",
    label: "Tropical beach",
    scene:
      "a sun-drenched tropical beach with palm trees, a turquoise shoreline, pastel beach umbrellas and a small longtail boat tied to a wooden post",
    bgImages: ["tropical-beach.webp"],
  },
  {
    id: "chateau-godl",
    emoji: "🏰",
    label: "Château de GODL",
    scene:
      "the back grounds of the Château de GODL — an opulent gold-and-white Vibetown chateau with a heart-shaped swimming pool, golden palm trees, white loungers, and the chateau's elegant facade in soft focus",
    bgImages: ["chateau.webp"],
  },
  {
    id: "neon-street",
    emoji: "🌃",
    label: "Neon street",
    scene:
      "a wide retro-futuristic Vibetown city street at dusk — a broad streetscape view showing multiple storefronts with rounded neon signage glowing in cyan, blue, and pink, reflective wet pavement catching the colored light, and a vintage scooter parked at the curb. ONE prominent neon sign on the street is the OpenSea logo (a glowing cyan-blue circular sign with a white sailboat-on-waves icon and 'OPENSEA' wordmark, exactly as shown in the OpenSea reference image) — mount it on a storefront facade as if it were any other neon shop sign, using the exact OpenSea brand colors (Sea Blue #2081E2, Marina Blue #15B2E5, Aqua #2BCDE4) for the neon tubing. Wide-enough framing to show several signs and the depth of the street, while still keeping the characters readable in the foreground",
    bgImages: ["neon-street.webp", "opensea-neon-logo.png"],
  },
  {
    id: "rooftop-sunset",
    emoji: "🌅",
    label: "Rooftop sunset",
    scene:
      "a small rooftop terrace at golden hour with a vintage rattan chair, string lights, a low table with a glass of juice, and city rooftops in the soft-blurred background",
    bgImages: ["rooftop-sunset.webp"],
  },
  {
    id: "lagoon-pier",
    emoji: "🏝️",
    label: "Lagoon pier",
    scene:
      "a wooden pier extending into a glassy turquoise lagoon, with floating leaves on the water and a small striped beach towel folded on the planks",
    bgImages: ["lagoon-pier.webp"],
  },
  {
    id: "coastal-drive",
    emoji: "🚗",
    label: "Coastal drive",
    scene:
      "a coastal road at sunrise with a mint-green retro convertible parked by the curb, palm shadows on the asphalt, and a vintage gas pump in the distance — render the subjects standing beside the car",
    bgImages: ["coastal-drive-street.webp", "coastal-drive-car.png"],
  },
];

export type ActionPreset = {
  id: string;
  emoji: string;
  label: string;
  /** Full action text appended into the prompt's SUBJECT ACTION line. */
  prompt: string;
};

export const ACTION_PRESETS: ActionPreset[] = [
  {
    id: "friendship",
    emoji: "🤝",
    label: "Friendship",
    prompt:
      "enjoying the bonds of friendship, side by side with easy body language",
  },
  {
    id: "celebrate",
    emoji: "🎉",
    label: "Celebrate",
    prompt: "arms thrown up mid-cheer in joyful celebration, confetti energy",
  },
  {
    id: "group-selfie",
    emoji: "🤳",
    label: "Group selfie",
    prompt:
      "leaning in for a group selfie with one arm extended forward holding a phone",
  },
  {
    id: "zen",
    emoji: "🧘",
    label: "Zen",
    prompt:
      "seated cross-legged in a calm meditative pose, hands resting on knees",
  },
  {
    id: "dance",
    emoji: "💃",
    label: "Dance",
    prompt:
      "caught mid-dance with loose limbs and weight shifted onto one foot",
  },
];

export type MoodPreset = {
  id: string;
  emoji: string;
  label: string;
  /** Mood text appended into the prompt's STYLE line. */
  prompt: string;
};

export const MOOD_PRESETS: MoodPreset[] = [
  {
    id: "joyful",
    emoji: "😊",
    label: "Joyful",
    prompt: "warm joyful glow — golden-hour light with soft smile energy",
  },
  {
    id: "chill",
    emoji: "😎",
    label: "Chill",
    prompt: "cool and effortless — relaxed, confident vibe",
  },
  {
    id: "hyped",
    emoji: "🔥",
    label: "Hyped",
    prompt: "saturated and electric — high-energy, kinetic atmosphere",
  },
  {
    id: "dreamy",
    emoji: "🌙",
    label: "Dreamy",
    prompt: "dreamy and ethereal — soft moonlit calm with hazy bokeh",
  },
  {
    id: "heroic",
    emoji: "💪",
    label: "Heroic",
    prompt: "bold and cinematic — strong stance, dramatic directional light",
  },
];

export type VibeSize = "1024x1024" | "1024x1536" | "1536x1024";

export const VIBE_SIZES: VibeSize[] = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
];

/** Resolve a preset id to its full preset (or undefined if unknown). */
export function findScene(id: string | null | undefined): ScenePreset | undefined {
  if (!id) return undefined;
  return SCENE_PRESETS.find((p) => p.id === id);
}

export function findAction(id: string | null | undefined): ActionPreset | undefined {
  if (!id) return undefined;
  return ACTION_PRESETS.find((p) => p.id === id);
}

export function findMood(id: string | null | undefined): MoodPreset | undefined {
  if (!id) return undefined;
  return MOOD_PRESETS.find((p) => p.id === id);
}
