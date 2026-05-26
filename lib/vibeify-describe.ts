import OpenAI from "openai";

/**
 * Vision-based source description.
 *
 * Step 1 of the v2 pipeline: instead of passing the user's photo pixels
 * to gpt-image-1 (which then tries to preserve facial geometry including
 * the nose), we first describe the photo in TEXT with gpt-4o-mini, and
 * then ask gpt-image-1 to render that description against the GVC
 * reference image. No source pixels reach the image-generation model
 * → no nose pixels to preserve.
 *
 * The vision prompt explicitly tells the describer to AVOID anything
 * about facial geometry. Identity markers (hair, beard, accessories,
 * clothing, palette) are what we carry forward — face anatomy comes
 * entirely from the GVC reference image in step 2.
 *
 * Cost: ~$0.0001 per call (gpt-4o-mini, low-detail image). Latency:
 * ~2-4 seconds. Both are dwarfed by the ~30s gpt-image-1 call.
 */
export async function describeSubject(
  buffer: Buffer,
  mime: string,
  apiKey: string
): Promise<string> {
  const openai = new OpenAI({ apiKey });
  const dataUrl = `data:${mime};base64,${buffer.toString("base64")}`;

  const result = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 800,
    messages: [
      {
        role: "system",
        content:
          "You are a brief, precise visual describer for a 3D character artist. You describe ONLY the identity-defining markers listed by the user (hair, facial hair, clothing, accessories, body proportions, expression via eye state only). The artist has separate templates for face geometry — never describe central face features (eyebrows, nose, lips, cheeks, jaw). Never describe the background or scene. Small identity markers — patches, pins, logos, embroidery, prints, badges, custom stitching — are CRITICAL: those are what make a vinyl figurine recognisable as a specific person. Always capture them in detail when visible.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Describe the subject(s) in this image for a 3D vinyl-figurine artist.

If humans/humanoids — for EACH person, in order left-to-right:
- count and approximate apparent age range
- hair (color, length, style, texture)
- facial hair — describe ALL facial hair as ONE unified feature, not as separate mustache/beard items. Pick whichever description matches and add color + length:
    * "Full beard and mustache merged together, [color], [length], covering the entire lower face from immediately below the eyes/upper-lip area down to the jawline" (use this for any subject with both a mustache AND a beard, even if they look distinct in the photo — they will be rendered as one continuous mass downstream)
    * "Mustache only, no beard, [color], [shape]"
    * "Stubble only — a faint dark tonal shadow on the chin and jaw, NOT a beard, NOT a mustache, NOT a hair shape; the face is otherwise clean-shaven with a visible mouth, [color]" (use this for any short stubble / 5-o'clock-shadow / unshaven look that is NOT a full beard)
    * "Clean-shaven, no facial hair on the chin, jaw, or upper lip"
- skin tone — use a SPECIFIC human-tone phrase with BOTH a hue AND a value (e.g. "light peach", "medium tan", "warm Mediterranean olive (not green)", "light olive (warm beige undertone, not green)", "medium brown", "dark brown", "warm beige"). DO NOT use ambiguous value-only words like "pale", "fair", or "light" without a hue qualifier — those get misread as saturated colors downstream when the reference set contains saturated artistic palette colors. When using "olive", ALWAYS qualify it as a warm human Mediterranean tone — the bare word "olive" gets rendered as a green-tinged skin downstream.
- eyewear (sunglasses style/color, regular glasses, none)
- headwear (hat, beanie, headband, none)
- clothing top (style, colors, layers — and ALL visible logos, prints, text, graphics on it)
- clothing bottom (style, colors, prints/text if any)
- footwear — if the feet are visible in the photo: describe style, colors, and any logos. If the feet are NOT visible (frame crops above the ankles, feet obscured by props/scenery, or the photo is shot from the waist up), write EXACTLY this string: "Not visible in source — render as plain casual low-top sneakers in a neutral tone (white, off-white, or tan) that suit the rest of the outfit." NEVER write "none" or "none visible" for footwear — the renderer interprets that as bare feet, which is wrong for a clothed character.
- jewelry / watch / accessories (every visible piece, with colors and shapes)
- FINE DETAILS — every patch, pin, badge, embroidery, sticker, button, sequin, embellishment visible on clothing, hats, or bags. List each one with its placement and what it shows (e.g. "small embroidered rainbow patch on left chest of denim jacket", "enamel pin of a yellow lightning bolt on hat brim"). These are the most important identity markers.
- anything in their hands
- pose / gesture in one short phrase
- expression — describe ONLY via EYE state (e.g. "closed-eye smile lines", "open relaxed eyes", "wide open surprised eyes", "neutral half-lidded"). DO NOT describe mouth/lip state — do not say "smiling broadly", "showing teeth", "grinning", "open mouth". DO NOT describe eyebrows. The renderer handles all face geometry per facial-hair rules.
- body proportions (slim / average / heavier / muscular)

Treat mustache and beard as SEPARATE pieces of facial hair — they often appear together but can also appear independently or not at all.

If non-humans (animals, objects, vehicles, food, plants):
- species/type
- color and distinctive markings
- pose / orientation
- any accessories, attachments, stickers, prints, or decorations
- fine details: stickers, labels, embellishments, decorations

RULES:
- Skip facial geometry — the artist's templates handle that. Only describe the items in the list above.
- Skip background, scene, lighting, weather.
- Be concrete and concise. Bullet points or short clauses. No flowery language.
- Capture small identity markers thoroughly — they matter more than generic clothing descriptions.
- If the image has multiple subjects, label them "Subject 1", "Subject 2", etc.`,
          },
          {
            type: "image_url",
            image_url: { url: dataUrl, detail: "high" },
          },
        ],
      },
    ],
  });

  const desc = result.choices?.[0]?.message?.content?.trim();
  if (!desc) {
    throw new Error("Vision describer returned no content.");
  }
  return desc;
}
