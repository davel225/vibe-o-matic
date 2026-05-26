// One-off: shrink all Flux reference assets to ≤768px on the long edge.
//
// Why: Flux.2 [pro] enforces a 9 MP TOTAL budget across output + all reference
// images per request. With 9 refs in play (1 body + 6 faces + 2 scene), we
// need each ref to be well under 1 MP. 768px long edge → ~0.59 MP per ref.
//
// This script resizes IN PLACE. Originals are recoverable via git.
// Skips files already at ≤768px long edge (idempotent).
//
// Run: node scripts/shrink-references.mjs

import sharp from "sharp";
import { readdir, stat, readFile, writeFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const TARGETS = [
  "public/scenes",
  "public/gvc-faces",
  "public/gvc-character-reference.png",
];

const MAX_LONG_EDGE = 768;

async function processFile(absPath) {
  const ext = extname(absPath).toLowerCase();
  if (![".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return null;

  const buf = await readFile(absPath);
  const img = sharp(buf);
  const meta = await img.metadata();
  const { width = 0, height = 0 } = meta;
  if (!width || !height) return null;

  const longEdge = Math.max(width, height);
  if (longEdge <= MAX_LONG_EDGE) {
    return { absPath, skipped: true, width, height };
  }

  const pipeline = sharp(buf).resize({
    width: width >= height ? MAX_LONG_EDGE : undefined,
    height: height > width ? MAX_LONG_EDGE : undefined,
    fit: "inside",
    withoutEnlargement: true,
  });

  let out;
  if (ext === ".png") {
    out = await pipeline.png({ compressionLevel: 9, palette: true }).toBuffer();
  } else if (ext === ".webp") {
    out = await pipeline.webp({ quality: 82 }).toBuffer();
  } else {
    out = await pipeline.jpeg({ quality: 85, mozjpeg: true }).toBuffer();
  }

  const newMeta = await sharp(out).metadata();
  await writeFile(absPath, out);
  return {
    absPath,
    skipped: false,
    before: { width, height, bytes: buf.length },
    after: { width: newMeta.width, height: newMeta.height, bytes: out.length },
  };
}

async function walk(absPath) {
  const s = await stat(absPath);
  if (s.isFile()) return [absPath];
  if (s.isDirectory()) {
    const entries = await readdir(absPath);
    const out = [];
    for (const e of entries) out.push(...(await walk(join(absPath, e))));
    return out;
  }
  return [];
}

const files = [];
for (const t of TARGETS) {
  try {
    files.push(...(await walk(join(ROOT, t))));
  } catch (e) {
    console.warn(`skip ${t}: ${e.message}`);
  }
}

console.log(`Processing ${files.length} files (max long edge = ${MAX_LONG_EDGE}px)...\n`);

const results = [];
for (const f of files) {
  const r = await processFile(f);
  if (!r) continue;
  results.push(r);
  const rel = f.replace(ROOT + "/", "");
  if (r.skipped) {
    console.log(`  ⏭  ${rel}  (already ${r.width}x${r.height})`);
  } else {
    const beforeKb = (r.before.bytes / 1024).toFixed(0);
    const afterKb = (r.after.bytes / 1024).toFixed(0);
    console.log(
      `  ✓  ${rel}  ${r.before.width}x${r.before.height} (${beforeKb}K) → ${r.after.width}x${r.after.height} (${afterKb}K)`
    );
  }
}

const resized = results.filter((r) => !r.skipped);
const totalBefore = resized.reduce((s, r) => s + r.before.bytes, 0);
const totalAfter = resized.reduce((s, r) => s + r.after.bytes, 0);
console.log(
  `\n${resized.length} files resized, ${results.length - resized.length} skipped.`
);
if (resized.length) {
  console.log(
    `Total bytes: ${(totalBefore / 1024 / 1024).toFixed(2)} MB → ${(
      totalAfter / 1024 / 1024
    ).toFixed(2)} MB`
  );
}
