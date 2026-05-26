import { GoogleGenAI } from "@google/genai";
import type { GvcReference } from "./vibeify-references";

export type GeminiSize = "1024x1024" | "1024x1536" | "1536x1024";

/**
 * Map our existing UI size strings to the closest Gemini aspect ratio.
 * Gemini accepts standard ratios; portrait 2:3 and landscape 3:2 are
 * the closest matches to OpenAI's 1024x1536 / 1536x1024.
 */
function aspectRatioFor(size: GeminiSize): "1:1" | "2:3" | "3:2" {
  if (size === "1024x1536") return "2:3";
  if (size === "1536x1024") return "3:2";
  return "1:1";
}

export type GeminiRenderOpts = {
  apiKey: string;
  prompt: string;
  references: GvcReference[];
  size: GeminiSize;
};

export type GeminiRenderResult = {
  /** Raw base64-encoded image bytes (no data: prefix). */
  imageB64: string;
  /** The mime type Gemini returned (usually image/png). */
  mimeType: string;
};

/**
 * Render with Google Gemini 2.5 Flash Image ("Nano Banana"). Accepts the
 * same multi-reference shape as the gpt-image-1 path — pass [T-pose,
 * ...face refs] as `references`, and the model will use them as visual
 * anchors for the text prompt.
 *
 * gemini-2.5-flash-image is Google's image generation/edit model with
 * strong character-consistency and multi-image conditioning. It
 * typically honors reference style more aggressively than gpt-image-1.
 */
export async function renderWithGemini(
  opts: GeminiRenderOpts
): Promise<GeminiRenderResult> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  // Build the content parts: prompt text first, then each reference image.
  const parts: Array<
    | { text: string }
    | { inlineData: { mimeType: string; data: string } }
  > = [{ text: opts.prompt }];

  for (const ref of opts.references) {
    parts.push({
      inlineData: {
        mimeType: ref.mimeType,
        data: ref.buffer.toString("base64"),
      },
    });
  }

  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: parts,
    config: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      responseModalities: ["IMAGE"] as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      imageConfig: { aspectRatio: aspectRatioFor(opts.size) } as any,
    },
  });

  // Find the inline image part in the response.
  const candidate = response.candidates?.[0];
  const responseParts = candidate?.content?.parts ?? [];
  for (const part of responseParts) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inline = (part as any).inlineData;
    if (inline?.data) {
      return {
        imageB64: inline.data,
        mimeType: inline.mimeType ?? "image/png",
      };
    }
  }

  // If we got here, the model returned text-only (safety block, refusal, etc.).
  const textPart = responseParts.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (p: any) => typeof p.text === "string"
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const text = (textPart as any)?.text ?? "no image and no text";
  throw new Error(`Gemini returned no image: ${text}`);
}
