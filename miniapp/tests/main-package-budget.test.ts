import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MAIN_PACKAGE_LIMIT_BYTES = 1.5 * 1024 * 1024;
const SUBPACKAGE_LIMIT_BYTES = 2 * 1024 * 1024;
const miniprogramRoot = resolve(import.meta.dirname, '..', 'miniprogram');
const projectConfigPath = resolve(import.meta.dirname, '..', 'project.config.json');
const packageJsonPath = resolve(import.meta.dirname, '..', 'package.json');

const measureFiles = (
  directory: string,
  ignoredDirectories: ReadonlySet<string>,
): { bytes: number; files: number } =>
  readdirSync(directory, { withFileTypes: true }).reduce(
    (total, entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (ignoredDirectories.has(path)) return total;
        const nested = measureFiles(path, ignoredDirectories);
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
  it('keeps the uploadable main package below 1.5 MiB and every subpackage below 2 MiB', () => {
    const projectConfig = JSON.parse(readFileSync(projectConfigPath, 'utf8')) as {
      packOptions?: { ignore?: { type: string; value: string }[] };
    };
    const app = JSON.parse(readFileSync(join(miniprogramRoot, 'app.json'), 'utf8')) as {
      subPackages?: Array<{ root: string }>;
    };
    const subpackageRoots = (app.subPackages ?? []).map((subpackage) =>
      resolve(miniprogramRoot, subpackage.root),
    );
    const ignoredDirectories = new Set(
      [
        (projectConfig.packOptions?.ignore ?? [])
          .filter((entry) => entry.type === 'folder')
          .map((entry) => resolve(miniprogramRoot, entry.value)),
        subpackageRoots,
      ].flat(),
    );
    const retiredTdesignBundle = resolve(miniprogramRoot, 'miniprogram_npm', 'tdesign-miniprogram');
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    const measurement = measureFiles(miniprogramRoot, ignoredDirectories);

    expect(measurement.files).toBeGreaterThan(0);
    expect(measurement.bytes).toBeLessThan(MAIN_PACKAGE_LIMIT_BYTES);
    expect(ignoredDirectories).toContain(retiredTdesignBundle);
    expect(packageJson.dependencies?.['tdesign-miniprogram']).toBeUndefined();
    expect(subpackageRoots).not.toHaveLength(0);
    for (const subpackageRoot of subpackageRoots) {
      expect(existsSync(subpackageRoot), `${subpackageRoot} is missing`).toBe(true);
      const subpackageMeasurement = measureFiles(subpackageRoot, new Set());
      expect(subpackageMeasurement.files).toBeGreaterThan(0);
      expect(subpackageMeasurement.bytes).toBeLessThan(SUBPACKAGE_LIMIT_BYTES);
    }
  });
});
