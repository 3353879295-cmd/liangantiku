import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

const fflateSource = (root) => join(root, 'node_modules', 'fflate', 'umd', 'index.js');
const fflateTarget = (root) => join(root, 'miniprogram', 'miniprogram_npm', 'fflate', 'index.js');

/**
 * Copies runtime-only packages that WeChat DevTools cannot build from their
 * published package entry points. `fflate` publishes a `.cjs` main entry,
 * while DevTools looks for an impossible `.cjs.js` file.
 */
export const prepareMiniprogramRuntimeDependencies = (root = projectRoot) => {
  const source = fflateSource(root);
  const target = fflateTarget(root);
  if (!existsSync(source)) {
    throw new Error(`Missing fflate runtime bundle: ${source}. Run npm install first.`);
  }

  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  return { fflate: target };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareMiniprogramRuntimeDependencies();
}
