/**
 * V1 prompt backup — "direct-edit with two images"
 *
 * This is the prompt approach we used before switching to the v2
 * vision-described pipeline. It passes BOTH the source photo and the
 * GVC reference image to gpt-image-1's edit endpoint and relies on a
 * strong written rule + reference image to suppress nose generation.
 *
 * Result on humans: nose still appears reliably, regardless of how the
 * rule is worded (we tried 5+ variations including the rule-first /
 * no-nose-word C+D version below). The model's identity-preservation
 * prior on the source pixels wins.
 *
 * Result on non-humans (animals, objects, vehicles): worked well — the
 * reference was correctly ignored and the source was stylized cleanly.
 *
 * If we ever want to A/B test or roll back, import buildPromptV1 here
 * and use it in place of buildPromptV2 in lib/vibeify-render.ts and
 * app/api/vibeify/route.ts. The OpenAI call would also need to flip
 * back to passing [sourceFile, referenceFile] instead of just
 * [referenceFile].
 */

export function buildPromptV1DirectEdit(
  scene: string,
  action: string,
  mood: string
): string {
  const sceneText =
    scene.trim() ||
    "a calm, premium Vibetown setting that complements the uploaded subject";
  const actionText = action.trim();
  const moodText = mood.trim();

  return `ABSOLUTE RULE — read first, never break
Every human face in the output has only TWO features on the front: eyes (or sunglasses / closed-eye smile lines) and a mouth (or facial hair covering it). The entire surface between them — forehead, cheeks, central face plane — is a single smooth, unbroken vinyl surface, exactly like a Lego minifig or Funko Pop. This rule overrides everything below.

(Animals, objects, vehicles, food, plants, and non-humanoid creatures keep their natural anatomy — the rule above applies only to humans, humanoids, portraits, and avatars.)

I've uploaded TWO images:
1. SOURCE — the subject I want transformed. Take from this: identity (hair, beard, eyebrows, skin tone, glasses, accessories, clothing, jewelry, items in hand, body proportions, expression, color palette, markings).
2. GVC-STYLE-REFERENCE.png — a canonical Good Vibes Club character T-pose (front, 3/4, rear). Take from this: face anatomy (per ABSOLUTE RULE above), head shape, vinyl finish, eye style, mouth style. Do NOT copy its hair, clothing, beard, accessories, or pose.

If SOURCE contains MULTIPLE people, render that exact number of separate characters — never merge them. Apply the ABSOLUTE RULE to every face.

TASK
Transform the SUBJECT of SOURCE into a Good Vibes Club / Vibetown vinyl figurine of itself, placed into the SCENE described below.

GVC FACE (mirror the reference)
- Round, soft skull with smooth matte vinyl finish and subtle micro-texture.
- TWO simple eyes — or sunglasses / visor / closed-eye smile lines.
- ONE small mouth — or hidden under mustache / beard if the source has one.
- The central face is one continuous smooth plane (per ABSOLUTE RULE).
- Keep on the face: ears, hair, eyebrows, beard, mustache, freckles, face tattoos, expression.

SCENE
${sceneText}

${actionText ? `SUBJECT ACTION\n${actionText}\n` : ""}WORLD
Environment is physically real and grounded — not a toy world. Believable objects, placement, weight, and depth. Diorama illusion of a real café / beach / street at miniature scale.

MATERIALS
Sand has fine grain. Vegetation has layered leaves. Water is reflective with slight transparency. Glass has reflections and refraction. Metals show subtle reflections. Fabrics have folds and natural drape.

COLOR
Pastel base palette (mint, peach, pink, cyan) for the environment, with localized saturation in signage, props, and plants. The subject keeps its own colors — do not wash into pastel.

CAMERA
High-angle or slight isometric, macro photography feel. Strong depth of field: foreground softly blurred, mid-ground extremely sharp where the subject sits, background gradually blurred.

EFFECT STACK (strong)
- strong tilt-shift miniature effect
- strong radial motion blur at edges, center clean
- subtle chromatic aberration
- fine cinematic film grain

LIGHTING
Soft directional sunlight with visible shadow shapes. Warm sunlight balanced against cooler ambient tones.

OUTPUT
A polished 3D Vibetown render of the SOURCE subject, restyled and placed into the scene. ${
    moodText
      ? `Mood: ${moodText}.`
      : "A calm but rich miniature moment — cinematic and alive."
  }

FINAL CHECK
For every human face in the output: confirm the central face plane (from eyes down to mouth) is a single smooth, unbroken vinyl surface — same as GVC-STYLE-REFERENCE. If you see ANY raised feature, bump, shadow line, or break in the surface between the eyes and the mouth, the face is wrong — regenerate it as smooth, like the reference.`;
}

/**
 * V2 prompt backup — "vision-described, single-reference"
 *
 * Step 1: gpt-4o-mini describes the source photo in text (identity markers
 * only, no facial geometry). Step 2: gpt-image-1 renders from the GVC
 * reference image + that text description. The source photo NEVER reaches
 * gpt-image-1 — so it can't preserve source pixels (including nose pixels).
 *
 * Result: solved the source-pixel preservation problem (button-nose
 * shadows from the photo stopped appearing), but the model's own default
 * "cute character" prior reintroduced small button-noses anyway. The
 * single reference image wasn't enough visual evidence to override that.
 *
 * Superseded by v2.2 (multi-reference) — see lib/vibeify-references.ts
 * for the new image loader and the inline prompt in route.ts /
 * vibeify-render.ts for the multi-ref prompt.
 */
export function buildPromptV2VisionDescribed(
  description: string,
  scene: string,
  action: string,
  mood: string
): string {
  const sceneText =
    scene.trim() ||
    "a calm, premium Vibetown setting that complements the uploaded subject";
  const actionText = action.trim();
  const moodText = mood.trim();

  return `You are rendering a Good Vibes Club / Vibetown vinyl figurine scene.

I've uploaded ONE image: GVC-STYLE-REFERENCE.png — a canonical Vibetown character T-pose (front, 3/4, rear). It is your visual template for EVERYTHING about how a Vibetown character looks: head shape, face anatomy, vinyl finish, body proportions, eye style, mouth style, surface material, lighting style. Match it exactly for the character body and face.

I have NOT uploaded the original photo of the subject. Instead, the subject is described in text below. Render that subject as a fresh Vibetown vinyl figurine — built from the GVC reference's anatomy, dressed and detailed per the description.

SUBJECT DESCRIPTION (use these as identity markers — hair, clothing, accessories, palette — do NOT invent face anatomy)
${description}

ABSOLUTE FACE RULE
Every human/humanoid face matches GVC-STYLE-REFERENCE: only TWO features on the front — eyes (or sunglasses / closed-eye smile lines) and a mouth (or facial hair covering it). The surface between them is a single smooth, unbroken vinyl plane, exactly like the reference. No bumps, no raised features, no shadow lines in that area. (Animals, objects, vehicles, food, plants, and non-humanoid creatures keep their natural anatomy.)

If the description lists multiple subjects, render that exact number — never merge them. Each subject gets its own GVC-style face per the rule above.

TASK
Place the described subject(s) into the SCENE below, as Vibetown vinyl figurines that look like they belong in the same universe as GVC-STYLE-REFERENCE.

SCENE
${sceneText}

${actionText ? `SUBJECT ACTION\n${actionText}\n` : ""}WORLD
Environment is physically real and grounded — not a toy world. Believable objects, placement, weight, and depth. Diorama illusion of a real café / beach / street at miniature scale.

MATERIALS
Sand has fine grain. Vegetation has layered leaves. Water is reflective with slight transparency. Glass has reflections and refraction. Metals show subtle reflections. Fabrics have folds and natural drape.

COLOR
Pastel base palette (mint, peach, pink, cyan) for the environment, with localized saturation in signage, props, and plants. Subjects keep the colors from the description — do not wash into pastel.

CAMERA
High-angle or slight isometric, macro photography feel. Strong depth of field: foreground softly blurred, mid-ground extremely sharp on the subject(s), background gradually blurred.

EFFECT STACK (strong)
- strong tilt-shift miniature effect
- strong radial motion blur at edges, center clean
- subtle chromatic aberration
- fine cinematic film grain

LIGHTING
Soft directional sunlight with visible shadow shapes. Warm sunlight balanced against cooler ambient tones.

OUTPUT
A polished 3D Vibetown render of the described subject(s), built fresh from the GVC reference's anatomy, placed into the scene. ${
    moodText
      ? `Mood: ${moodText}.`
      : "A calm but rich miniature moment — cinematic and alive."
  }

FINAL CHECK
For every human face in the output: confirm the central face plane (from eyes down to mouth) matches GVC-STYLE-REFERENCE — one continuous smooth vinyl surface with no raised features between the eyes and mouth. If any face shows a raised feature, bump, or shadow break in that area, regenerate it to match the reference.`;
}
