import type { GvcReference } from "./vibeify-references";

/**
 * Render with Black Forest Labs FLUX.2 [PRO] — the multi-reference editing
 * model. Up to 9 reference images per request, async submit-and-poll API.
 *
 * Workflow:
 *   1. POST to /v1/flux-2-pro with prompt + up to 9 base64-encoded
 *      input_image / input_image_2 / ... / input_image_8 fields
 *   2. Receive { id, polling_url } — async task created
 *   3. Poll polling_url every ~1.5 s until status === "Ready"
 *   4. Response contains result.sample as a signed URL (expires in 10 min)
 *   5. Fetch the URL, return base64
 *
 * BFL docs: https://docs.bfl.ml/api-reference/models/generate-or-edit-an-image-with-flux2-[pro]-recommended-for-editing.md
 */

const BFL_ENDPOINT = "https://api.bfl.ai/v1/flux-2-pro";

export type FluxSize = "1024x1024" | "1024x1536" | "1536x1024";

function dimsFor(size: FluxSize): { width: number; height: number } {
  if (size === "1024x1536") return { width: 1024, height: 1536 };
  if (size === "1536x1024") return { width: 1536, height: 1024 };
  return { width: 1024, height: 1024 };
}

export type FluxRenderOpts = {
  apiKey: string;
  prompt: string;
  references: GvcReference[];
  size: FluxSize;
  /** How long to wait for the async job before erroring (default 90 s). */
  timeoutMs?: number;
};

export type FluxRenderResult = {
  /** Raw base64-encoded image bytes (no data: prefix). */
  imageB64: string;
  /** Mime type the rendered image was returned as. */
  mimeType: string;
};

/**
 * Build the BFL request body from a prompt + up to 9 references.
 * FLUX.2 PRO uses individual named fields (input_image, input_image_2, ..., input_image_8).
 */
function buildBody(
  prompt: string,
  references: GvcReference[],
  width: number,
  height: number
) {
  const body: Record<string, unknown> = {
    prompt,
    width,
    height,
    output_format: "png",
    safety_tolerance: 2,
  };
  const slots = [
    "input_image",
    "input_image_2",
    "input_image_3",
    "input_image_4",
    "input_image_5",
    "input_image_6",
    "input_image_7",
    "input_image_8",
  ];
  references.slice(0, slots.length).forEach((ref, i) => {
    body[slots[i]] = ref.buffer.toString("base64");
  });
  return body;
}

async function pollUntilReady(
  pollingUrl: string,
  apiKey: string,
  timeoutMs: number
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(pollingUrl, {
      method: "GET",
      headers: { "x-key": apiKey, accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Polling failed: HTTP ${res.status}`);
    }
    const data = (await res.json()) as {
      status?: string;
      result?: { sample?: string };
    };
    const status = data.status;
    if (status === "Ready") {
      const sample = data.result?.sample;
      if (!sample) throw new Error("Flux job ready but no sample URL returned.");
      return sample;
    }
    if (
      status === "Error" ||
      status === "Content Moderated" ||
      status === "Request Moderated" ||
      status === "Task not found"
    ) {
      throw new Error(`Flux job failed: ${status}`);
    }
    // Otherwise still pending (status: Pending / "" / undefined) — keep polling.
  }
  throw new Error(`Flux job timed out after ${timeoutMs}ms`);
}

export async function renderWithFlux(
  opts: FluxRenderOpts
): Promise<FluxRenderResult> {
  const { apiKey, prompt, references, size, timeoutMs = 90_000 } = opts;
  const { width, height } = dimsFor(size);
  const body = buildBody(prompt, references, width, height);

  // 1. Submit job
  const submitRes = await fetch(BFL_ENDPOINT, {
    method: "POST",
    headers: {
      "x-key": apiKey,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!submitRes.ok) {
    let detail = "";
    try {
      detail = JSON.stringify(await submitRes.json());
    } catch {
      detail = await submitRes.text();
    }
    throw new Error(
      `Flux submit failed: HTTP ${submitRes.status} ${detail.slice(0, 400)}`
    );
  }
  const submitData = (await submitRes.json()) as {
    id?: string;
    polling_url?: string;
  };
  if (!submitData.polling_url) {
    throw new Error("Flux submit returned no polling_url");
  }

  // 2. Poll until ready
  const sampleUrl = await pollUntilReady(
    submitData.polling_url,
    apiKey,
    timeoutMs
  );

  // 3. Fetch the result image and convert to base64
  const imgRes = await fetch(sampleUrl);
  if (!imgRes.ok) {
    throw new Error(
      `Failed to fetch Flux result image: HTTP ${imgRes.status}`
    );
  }
  const arrayBuf = await imgRes.arrayBuffer();
  const mimeType = imgRes.headers.get("content-type") || "image/png";
  return {
    imageB64: Buffer.from(arrayBuf).toString("base64"),
    mimeType,
  };
}
