import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

type RuntimeDependencyPreparer = (root?: string) => { fflate: string };

const runtimeDependencyModulePath: string = '../scripts/prepare-miniprogram-runtime-deps.mjs';

const loadRuntimeDependencyPreparer = async (): Promise<RuntimeDependencyPreparer> => {
  const dependencyScript = (await import(runtimeDependencyModulePath)) as unknown as {
    prepareMiniprogramRuntimeDependencies: RuntimeDependencyPreparer;
  };
  return dependencyScript.prepareMiniprogramRuntimeDependencies;
};

describe('miniprogram runtime dependencies', () => {
  it('copies the fflate UMD bundle into the module path used by WeChat DevTools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'grain-runtime-dependencies-'));
    const source = join(root, 'node_modules', 'fflate', 'umd');
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, 'index.js'), 'module.exports = { gunzipSync() {} };', 'utf8');

    const prepareRuntimeDependencies = await loadRuntimeDependencyPreparer();
    const result = prepareRuntimeDependencies(root);

    expect(result.fflate).toBe(join(root, 'miniprogram', 'miniprogram_npm', 'fflate', 'index.js'));
    expect(readFileSync(result.fflate, 'utf8')).toContain('gunzipSync');
  });
});
