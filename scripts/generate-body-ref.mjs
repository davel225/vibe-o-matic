/**
 * One-off script: generate a neutral standing-pose GVC body reference
 * using Gemini 2.5 Flash Image, anchored by the current T-pose ref.
 *
 * Backs up the existing T-pose ref so we can A/B-test or revert.
 *
 * Run:
 *   node --env-file=.env.local scripts/generate-body-ref.mjs
 */

import { GoogleGenAI } from "@google/genai";
import { readFile, writeFile, copyFile, access } from "node:fs/promises";
import { join } from "node:path";

const apiKey = process.env.GOOGLE_API_KEY;
if (!apiKey) {
  console.error("GOOGLE_API_KEY not set. Use --env-file=.env.local or export the var.");
  process.exit(1);
}

const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, "public");
const REF_PATH = join(PUBLIC_DIR, "gvc-character-reference.png");
const BACKUP_PATH = join(PUBLIC_DIR, "gvc-character-reference.tpose.png");

// Backup the existing T-pose ref (only if backup doesn't already exist — don't clobber a previous backup)
try {
  await access(BACKUP_PATH);
  console.log("• Backup already exists at gvc-character-reference.tpose.png — leaving it alone.");
} catch {
  await copyFile(REF_PATH, BACKUP_PATH);
  console.log("• Backed up current T-pose ref → gvc-character-reference.tpose.png");
}

// Load the ORIGINAL T-pose ref from the backup as our visual anchor — not the
// current ref (which may itself be a previously-generated body ref carrying its
// own artifacts forward each re-run).
const tposeBuffer = await readFile(BACKUP_PATH);
console.log(`• Loaded original T-pose backup as anchor (${(tposeBuffer.length / 1024).toFixed(0)} KB)`);

const prompt = `Generate a single Good Vibes Club / Vibetown vinyl figurine character — a NEUTRAL STANDING REFERENCE for body-proportions and material only.

CRITICAL: Match the uploaded GVC T-pose reference's FACE STYLE EXACTLY. The T-pose ref's face has ONLY two curved closed-eye smile lines — NOTHING ELSE on the face. No mouth, no eyebrows, no nose, no chin features. Just two closed-eye smile-line curves where the eyes would be. Your output's face must have the IDENTICAL feature set: only the two closed-eye smile lines, and nothing else.

This is a body/material reference — the face is intentionally minimal. Separate face references handle facial features in the larger pipeline; this image's only job is to anchor body proportions, vinyl material, and natural standing pose.

CHARACTER (match these exactly):
- Round smooth vinyl head — face has ONLY two closed-eye smile lines (curved short dark marks where eyes would be). NO mouth. NO nose. NO eyebrows. NO chin marks. NO other facial features whatsoever.
- Matte vinyl finish with subtle micro-texture
- Short dark brown hair, simple style
- Natural light tan / peach skin tone — realistic human skin, NOT saturated, NOT yellow, NOT pink
- Plain neutral grey crew-neck t-shirt
- Plain dark navy pants
- Simple white sneakers
- Clean-shaven (no facial hair)
- Arms RELAXED at sides, palms toward body — NOT outstretched, NOT T-pose
- Front-facing
- FULL body visible head-to-feet, standing on neutral surface
- Weight evenly on both feet, natural stance

BACKGROUND: Plain off-white / very light beige solid color. No scene context, no objects, no decorations, no other characters, no text. Soft drop-shadow under the feet only.

OUTPUT: Single clean character reference image — one character, full body head-to-feet, front-facing, arms relaxed at sides, FACE WITH ONLY TWO CLOSED-EYE SMILE LINES AND NOTHING ELSE, neutral background. Square aspect.`;

console.log("• Calling gemini-2.5-flash-image...");
const ai = new GoogleGenAI({ apiKey });
const result = await ai.models.generateContent({
  model: "gemini-2.5-flash-image",
  contents: [
    { text: prompt },
    {
      inlineData: {
        mimeType: "image/png",
        data: tposeBuffer.toString("base64"),
      },
    },
  ],
  config: {
    responseModalities: ["IMAGE"],
    imageConfig: { aspectRatio: "1:1" },
  },
});

const parts = result.candidates?.[0]?.content?.parts ?? [];
const inline = parts.map((p) => p.inlineData).find((i) => i?.data);
if (!inline) {
  console.error("✗ No image returned. Response:");
  console.error(JSON.stringify(result, null, 2));
  process.exit(1);
}

const buffer = Buffer.from(inline.data, "base64");
await writeFile(REF_PATH, buffer);

console.log(`\n✓ New body ref saved → public/gvc-character-reference.png`);
console.log(`  Size: ${(buffer.length / 1024).toFixed(0)} KB, mime: ${inline.mimeType || "image/png"}`);
console.log(`  Backup: public/gvc-character-reference.tpose.png`);
console.log(`\nNext: refresh the page and run a Vibe-ify. To revert:`);
console.log(`  mv public/gvc-character-reference.tpose.png public/gvc-character-reference.png`);
