import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(scriptDirectory, '..');

const fflateSource = (root) => join(root, 'node_modules', 'fflate', 'esm', 'browser.js');
const fflateTarget = (root) => join(root, 'miniprogram', 'miniprogram_npm', 'fflate', 'index.js');
const fflateDirectory = (root) => join(root, 'node_modules', 'fflate');

const fflateLicenseBanner = (root) => {
  const directory = fflateDirectory(root);
  const packagePath = join(directory, 'package.json');
  const licensePath = join(directory, 'LICENSE');
  const packageMetadata = JSON.parse(readFileSync(packagePath, 'utf8'));
  if (typeof packageMetadata.version !== 'string' || !packageMetadata.version) {
    throw new Error(`Missing fflate package version: ${packagePath}`);
  }
  return `/* fflate v${packageMetadata.version}\n\n${readFileSync(licensePath, 'utf8').trim()}\n*/`;
};

/**
 * Bundles the two runtime-only fflate APIs that WeChat DevTools resolves from
 * miniprogram_npm. The browser entry avoids Node and worker dependencies.
 */
export const prepareMiniprogramRuntimeDependencies = (root = projectRoot) => {
  const source = fflateSource(root);
  const target = fflateTarget(root);
  if (!existsSync(source)) {
    throw new Error(`Missing fflate browser entry: ${source}. Run npm install first.`);
  }

  mkdirSync(dirname(target), { recursive: true });
  buildSync({
    absWorkingDir: root,
    banner: { js: fflateLicenseBanner(root) },
    bundle: true,
    format: 'cjs',
    minify: true,
    outfile: target,
    platform: 'browser',
    stdin: {
      contents: `export { gunzipSync, strFromU8 } from ${JSON.stringify(source)};`,
      loader: 'js',
      resolveDir: root,
    },
    target: 'es2018',
  });
  return { fflate: target };
};

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  prepareMiniprogramRuntimeDependencies();
}
