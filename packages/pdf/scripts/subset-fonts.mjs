// Builds the embedded font subsets (plan §8.5): Noto Sans Regular and Bold, limited to the
// characters forms in Aotearoa New Zealand need, including te reo Māori macrons (ā ē ī ō ū).
// Run with `pnpm --filter @qb/pdf fonts` after changing the ranges; the outputs are committed.
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import subsetFont from 'subset-font';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const src = dirname(require.resolve('@expo-google-fonts/noto-sans/package.json'));

const RANGES = [
  [0x0020, 0x007e], // Basic Latin
  [0x00a0, 0x00ff], // Latin-1 Supplement (°, é, ×, …)
  [0x0100, 0x017f], // Latin Extended-A (ā ē ī ō ū and capitals)
  [0x0300, 0x036f], // Combining diacritics (combining macron U+0304)
  [0x2010, 0x2027], // Dashes, quotes, bullets, ellipsis
  [0x2030, 0x203a], // Per mille, primes, angle quotes
  [0x20ac, 0x20ac], // Euro
  [0x2122, 0x2122], // Trade mark
];
const text = RANGES.flatMap(([a, b]) =>
  Array.from({ length: b - a + 1 }, (_, i) => String.fromCodePoint(a + i)),
).join('');

for (const [weight, file] of [
  ['Regular', '400Regular/NotoSans_400Regular.ttf'],
  ['Bold', '700Bold/NotoSans_700Bold.ttf'],
]) {
  const full = await readFile(join(src, file));
  const subset = await subsetFont(full, text, { targetFormat: 'truetype' });
  const out = join(here, '..', 'fonts', `NotoSans-${weight}.subset.ttf`);
  await writeFile(out, subset);
  console.log(`${out}: ${full.length} → ${subset.length} bytes`);
}
await copyFile(join(src, 'LICENSE_FONT'), join(here, '..', 'fonts', 'OFL.txt'));
