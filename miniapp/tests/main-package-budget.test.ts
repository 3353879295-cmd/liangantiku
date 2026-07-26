import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MAIN_PACKAGE_LIMIT_BYTES = 2 * 1024 * 1024;
const miniprogramRoot = resolve(import.meta.dirname, '..', 'miniprogram');

const measureFiles = (directory: string): { bytes: number; files: number } =>
  readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        const nested = measureFiles(path);
        return {
          bytes: total.bytes + nested.bytes,
          files: total.files + nested.files,
        };
      }
      if (!entry.isFile()) return total;
      return {
        bytes: total.bytes + statSync(path).size,
        files: total.files + 1,
      };
    },
    { bytes: 0, files: 0 },
  );

describe('main package release budget', () => {
  it('keeps the actual miniprogram file tree within the 2 MiB upload limit', () => {
    const measurement = measureFiles(miniprogramRoot);

    expect(measurement.files).toBeGreaterThan(0);
    expect(measurement.bytes).toBeLessThanOrEqual(MAIN_PACKAGE_LIMIT_BYTES);
  });
});
