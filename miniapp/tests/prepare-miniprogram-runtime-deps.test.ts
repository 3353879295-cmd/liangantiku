import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { transformSync } from 'esbuild';
import vm from 'node:vm';

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
  it('bundles only the browser decompression APIs into the module path used by WeChat DevTools', async () => {
    const root = mkdtempSync(join(tmpdir(), 'grain-runtime-dependencies-'));
    const source = join(root, 'node_modules', 'fflate', 'esm');
    mkdirSync(source, { recursive: true });
    writeFileSync(
      join(source, 'browser.js'),
      'export const gunzipSync = (value) => value; export const strFromU8 = () => "ok";',
      'utf8',
    );
    const packageRoot = join(root, 'node_modules', 'fflate');
    writeFileSync(join(packageRoot, 'package.json'), '{"version":"0.0.0-test"}', 'utf8');
    writeFileSync(
      join(packageRoot, 'LICENSE'),
      'MIT License\n\nCopyright (c) Test Holder\n\nPermission is hereby granted, free of charge, to any person obtaining a copy',
      'utf8',
    );

    const prepareRuntimeDependencies = await loadRuntimeDependencyPreparer();
    const result = prepareRuntimeDependencies(root);

    expect(result.fflate).toBe(join(root, 'miniprogram', 'miniprogram_npm', 'fflate', 'index.js'));
    const bundle = readFileSync(result.fflate, 'utf8');
    expect(bundle).toContain('fflate v0.0.0-test');
    expect(bundle).toContain('Copyright (c) Test Holder');
    expect(bundle).toContain('Permission is hereby granted, free of charge');
    expect(bundle).toContain('gunzipSync');
    expect(bundle).not.toContain('worker_threads');
    expect(bundle).not.toContain('require(');
  });

  it('decodes UTF-8 gzip data without TextDecoder and preserves every runtime question shard', async () => {
    const prepareRuntimeDependencies = await loadRuntimeDependencyPreparer();
    const { fflate } = prepareRuntimeDependencies();
    const firstBundle = readFileSync(fflate, 'utf8');
    prepareRuntimeDependencies();
    expect(readFileSync(fflate, 'utf8')).toBe(firstBundle);
    const module = { exports: {} as Record<string, unknown> };
    vm.runInNewContext(firstBundle, {
      module,
      exports: module.exports,
      TextDecoder: undefined,
    });
    const decoder = module.exports as {
      gunzipSync(value: Uint8Array): Uint8Array;
      strFromU8(value: Uint8Array): string;
    };

    const utf8Gzip = gzipSync(Buffer.from('粮安题库：中文解压验证', 'utf8'));
    expect(decoder.strFromU8(decoder.gunzipSync(new Uint8Array(utf8Gzip)))).toBe(
      '粮安题库：中文解压验证',
    );

    const recordsPath = join(
      import.meta.dirname,
      '..',
      'miniprogram',
      'data',
      'questions',
      'runtime-question-records.ts',
    );
    const transformed = transformSync(readFileSync(recordsPath, 'utf8'), {
      format: 'cjs',
      loader: 'ts',
      target: 'es2018',
    });
    const recordsModule = { exports: {} as Record<string, unknown> };
    vm.runInNewContext(transformed.code, {
      module: recordsModule,
      exports: recordsModule.exports,
      TextDecoder: undefined,
      atob: (value: string) => Buffer.from(value, 'base64').toString('binary'),
      require: (id: string) => {
        if (id === 'fflate') return decoder;
        throw new Error(`Unexpected runtime dependency: ${id}`);
      },
    });
    const records = (recordsModule.exports.loadRuntimeQuestionRecords as () => unknown[])();
    expect(records).toHaveLength(7_428);
  });
});
