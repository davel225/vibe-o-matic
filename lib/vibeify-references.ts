import { readFile, readdir } from "node:fs/promises";
import { join, extname } from "node:path";

/**
 * v2.2 multi-reference loader (provider-agnostic).
 *
 * Returns raw buffer + mimeType for each reference image, so any image
 * provider (FLUX.2 [pro] today; other multi-ref endpoints in the future)
 * can consume them without coupling this file to a specific SDK.
 *
 * Includes:
 *  - GVC-STYLE-REFERENCE.png — body T-pose template (front, 3/4, rear).
 *  - All image files in public/gvc-faces/ — face references at varied
 *    expressions/colors. Auto-picks up new files (no cache).
 *
 * No caching — re-reads from disk every call so dropping new files into
 * public/gvc-faces/ takes effect on the next render.
 */

const PUBLIC_DIR = join(process.cwd(), "public");
const BODY_REF_PATH = join(PUBLIC_DIR, "gvc-character-reference.png");
const FACES_DIR = join(PUBLIC_DIR, "gvc-faces");
const SCENES_DIR = join(PUBLIC_DIR, "scenes");

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

/**
 * Curated subset of face refs to send to FLUX.2 [pro], in priority order.
 *
 * Why a subset instead of "load every file"? FLUX.2 [pro] enforces a 9 MP
 * total budget across (output + sum of references). Per-ref cost is
 * effectively ~0.9 MP regardless of how small we shrink each file, so the
 * only meaningful lever for budget is REFERENCE COUNT, not pixel dimensions.
 *
 * With 4 faces + 1 body + 2 scene refs = 7 refs (~6.3 MP), we leave headroom
 * for non-square outputs (2 MP) — total ~8.3 MP under the 9 MP cap.
 *
 * The four selected faces cover the canonical GVC expression range:
 *   - face-gradient-beard.png   → bearded structure (critical anchor)
 *   - face-blue-meditation.jpg  → closed/curved smile lines (happy / relaxed)
 *   - face-red-happy.jpg        → open black-dot eyes (neutral / alert)
 *   - face-purple-mischievous.jpg → squint (mischievous)
 *
 * Dropped (still on disk for future use): face-pink-laugh, face-mint-dead.
 *
 * Edit this list to swap which faces are active — the loader will pick up
 * whichever files in this list actually exist on disk.
 */
const FACE_PRIORITY: string[] = [
  "face-gradient-beard.png",
  "face-blue-meditation.jpg",
  "face-red-happy.jpg",
  "face-purple-mischievous.jpg",
];

function mimeFromExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  return "image/jpeg";
}

export type GvcReference = {
  filename: string;
  buffer: Buffer;
  mimeType: string;
};

export type LoadedReferences = {
  /** [body T-pose, ...face refs]. Empty if body ref is missing. */
  refs: GvcReference[];
  /** All filenames in load order. */
  filenames: string[];
  /** Subset of filenames that are face refs only. */
  faceFilenames: string[];
};

/**
 * Load named scene background reference image(s) from public/scenes/.
 * Filenames are supplied by the active scene preset (or user form data).
 * Missing files are silently skipped (logged) so a bad filename doesn't
 * kill the render.
 */
export async function loadSceneBackgrounds(
  filenames: string[]
): Promise<GvcReference[]> {
  const out: GvcReference[] = [];
  for (const raw of filenames) {
    const name = raw.trim();
    if (!name) continue;
    // Reject anything with slashes — only allow flat filenames under SCENES_DIR.
    if (name.includes("/") || name.includes("\\") || name.includes("..")) {
      console.warn(`[vibeify] refusing unsafe scene filename: ${name}`);
      continue;
    }
    if (!IMAGE_EXTS.has(extname(name).toLowerCase())) {
      console.warn(`[vibeify] skipping non-image scene file: ${name}`);
      continue;
    }
    try {
      const buffer = await readFile(join(SCENES_DIR, name));
      out.push({
        filename: name,
        buffer,
        mimeType: mimeFromExt(extname(name)),
      });
    } catch (e) {
      console.warn(
        `[vibeify] scene bg missing: ${name} — ${(e as Error).message}`
      );
    }
  }
  return out;
}

export async function loadGvcReferences(): Promise<LoadedReferences> {
  const refs: GvcReference[] = [];
  const filenames: string[] = [];
  const faceFilenames: string[] = [];

  // Body T-pose (required — if missing, return empty so the route can 500).
  try {
    const buffer = await readFile(BODY_REF_PATH);
    refs.push({
      filename: "GVC-STYLE-REFERENCE.png",
      buffer,
      mimeType: "image/png",
    });
    filenames.push("GVC-STYLE-REFERENCE.png");
  } catch {
    return { refs: [], filenames: [], faceFilenames: [] };
  }

  // Face references — only the curated FACE_PRIORITY subset, in priority order.
  // Skips entries that don't exist on disk so the loader stays robust if a
  // file is renamed or removed. See FACE_PRIORITY comment for budget rationale.
  try {
    const entries = new Set(await readdir(FACES_DIR));
    for (const name of FACE_PRIORITY) {
      if (!entries.has(name)) continue;
      if (!IMAGE_EXTS.has(extname(name).toLowerCase())) continue;
      const buffer = await readFile(join(FACES_DIR, name));
      refs.push({
        filename: name,
        buffer,
        mimeType: mimeFromExt(extname(name)),
      });
      filenames.push(name);
      faceFilenames.push(name);
    }
  } catch {
    // Face dir missing or unreadable — body ref alone still works.
  }

  return { refs, filenames, faceFilenames };
}
