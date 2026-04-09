/**
 * Reads all .py files from src/lib/calc-library/ and generates a TypeScript
 * module that exports their contents as string constants. This ensures the
 * Python calc library survives Next.js bundling and works on Vercel where
 * the original .py source files aren't present at runtime.
 *
 * Run via: node scripts/bundle-calc-library.mjs
 * Hooked into builds via the "prebuild" script in package.json.
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_DIR = join(ROOT, 'src', 'lib', 'calc-library');
const OUT_FILE = join(ROOT, 'src', 'lib', 'calc-library-bundle.generated.ts');

const pyFiles = readdirSync(LIB_DIR)
  .filter(f => f.endsWith('.py') && !f.startsWith('test_'))
  .sort();

if (pyFiles.length === 0) {
  console.error('[bundle-calc-library] No .py files found in', LIB_DIR);
  process.exit(1);
}

const entries = pyFiles.map(f => {
  const content = readFileSync(join(LIB_DIR, f), 'utf-8');
  const escaped = JSON.stringify(content);
  return `  ${JSON.stringify(f)}: ${escaped},`;
});

const output = `// AUTO-GENERATED — do not edit. Run "node scripts/bundle-calc-library.mjs" to regenerate.
// Source: src/lib/calc-library/*.py (${pyFiles.length} files)

export const CALC_LIBRARY_FILES: Record<string, string> = {
${entries.join('\n')}
};
`;

writeFileSync(OUT_FILE, output, 'utf-8');
console.log(`[bundle-calc-library] Generated ${OUT_FILE} (${pyFiles.length} files)`);
