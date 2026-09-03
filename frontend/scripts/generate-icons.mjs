// One-off/regeneratable script: builds every PWA icon size from the source
// logo. Re-run with `node scripts/generate-icons.mjs` whenever the logo
// changes — the generated files are checked in under public/icons/.
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const source = path.join(root, 'src/assets/logo.jpg');
const outDir = path.join(root, 'public/icons');

mkdirSync(outDir, { recursive: true });

const WHITE = { r: 255, g: 255, b: 255, alpha: 1 };

/**
 * Composites the source mark onto a square canvas of `size`, with the mark
 * occupying `(1 - marginRatio*2)` of the canvas — i.e. marginRatio is the
 * padding on each side as a fraction of the canvas size.
 */
async function squareIcon(size, marginRatio, background = WHITE) {
  const inner = Math.round(size * (1 - marginRatio * 2));
  const mark = await sharp(source)
    .resize(inner, inner, { fit: 'contain', background })
    .toBuffer();

  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mark, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function main() {
  // Standard icons: light padding, used by the install prompt and app lists.
  const sizes = [
    { file: 'pwa-64x64.png', size: 64, margin: 0.1 },
    { file: 'pwa-192x192.png', size: 192, margin: 0.12 },
    { file: 'pwa-512x512.png', size: 512, margin: 0.12 },
    { file: 'apple-touch-icon.png', size: 180, margin: 0.14 },
  ];
  for (const { file, size, margin } of sizes) {
    const buf = await squareIcon(size, margin);
    await sharp(buf).toFile(path.join(outDir, file));
    console.log('wrote', file);
  }

  // Maskable: OS icon shapes crop up to ~20% off each edge, so the mark must
  // sit well inside a larger safe zone than the standard icons.
  const maskable = await squareIcon(512, 0.22);
  await sharp(maskable).toFile(path.join(outDir, 'maskable-icon-512x512.png'));
  console.log('wrote maskable-icon-512x512.png');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
