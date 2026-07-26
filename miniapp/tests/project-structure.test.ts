import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const miniappRoot = resolve(import.meta.dirname, '..', 'miniprogram');
const projectRoot = resolve(miniappRoot, '..');

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

interface ComponentConfig {
  usingComponents?: Record<string, string>;
}

interface AppConfig extends ComponentConfig {
  pages: string[];
  tabBar?: {
    custom?: boolean;
    list?: Array<{ pagePath: string }>;
  };
}

interface ProjectConfig {
  setting?: {
    packNpmManually?: boolean;
    packNpmRelationList?: Array<{
      packageJsonPath: string;
      miniprogramNpmDistDir: string;
    }>;
  };
}

const assertUnitFiles = (unitPath: string) => {
  for (const extension of ['.json', '.ts', '.wxml', '.wxss']) {
    expect(existsSync(`${unitPath}${extension}`), `${unitPath}${extension} is missing`).toBe(true);
  }
};

const assertComponentsResolve = (configPath: string) => {
  const config = readJson<ComponentConfig>(configPath);
  for (const componentPath of Object.values(config.usingComponents ?? {})) {
    if (componentPath.startsWith('/')) {
      assertUnitFiles(join(miniappRoot, componentPath));
      continue;
    }

    const segments = componentPath.split('/');
    const packageName = componentPath.startsWith('@')
      ? `${segments.shift()}/${segments.shift()}`
      : segments.shift();
    expect(packageName, `${componentPath} has no npm package name`).toBeTruthy();
    const packageRoot = join(miniappRoot, '..', 'node_modules', packageName ?? '');
    const packageConfig = readJson<{ miniprogram?: string }>(join(packageRoot, 'package.json'));
    const packageComponent = join(packageRoot, packageConfig.miniprogram ?? '', ...segments).concat(
      '.json',
    );
    expect(existsSync(packageComponent), `${componentPath} is not installed`).toBe(true);
  }
};

describe('WeChat mini program structure', () => {
  it('maps npm dependencies into the configured miniprogram root', () => {
    const project = readJson<ProjectConfig>(join(projectRoot, 'project.config.json'));

    expect(project.setting?.packNpmManually).toBe(true);
    expect(project.setting?.packNpmRelationList).toEqual([
      {
        packageJsonPath: './package.json',
        miniprogramNpmDistDir: './miniprogram/',
      },
    ]);
  });

  it('ships the canonical and generated catalogs without the legacy library presenter', () => {
    for (const relativePath of [
      join(miniappRoot, '..', '..', 'data', 'knowledge_catalog.json'),
      join(miniappRoot, 'data', 'knowledge-catalog.ts'),
      join(miniappRoot, 'data', 'questions', 'runtime-knowledge-catalog.ts'),
    ]) {
      expect(existsSync(relativePath)).toBe(true);
    }

    const libraryPage = readFileSync(join(miniappRoot, 'pages', 'library', 'index.ts'), 'utf8');
    expect(libraryPage).not.toContain('presentLibraryModules');
  });

  it('renders textbook chapter metrics and section learning status', () => {
    const libraryMarkup = readFileSync(join(miniappRoot, 'pages', 'library', 'index.wxml'), 'utf8');

    for (const binding of [
      '{{chapter.metaText}}',
      '{{chapter.progressText}}',
      '{{chapter.accuracyText}}',
      '{{chapter.wrongText}}',
      '{{section.statusText}}',
    ]) {
      expect(libraryMarkup).toContain(binding);
    }
    expect(libraryMarkup).not.toContain('待录入');
  });

  it('clears a selected saved-question chapter when occupation or level changes', () => {
    const questionListPage = readFileSync(
      join(miniappRoot, 'pages', 'question-list', 'index.ts'),
      'utf8',
    );

    expect(questionListPage).toContain("this.setData({ occupation: value, chapterId: '' });");
    expect(questionListPage).toContain("this.setData({ level: Number(value), chapterId: '' });");
  });

  it('has a complete file set for every registered page and local component', () => {
    const app = readJson<AppConfig>(join(miniappRoot, 'app.json'));

    expect(app.pages).toHaveLength(9);
    for (const page of app.pages) {
      const pagePath = join(miniappRoot, page);
      assertUnitFiles(pagePath);
      assertComponentsResolve(`${pagePath}.json`);
    }

    expect(app.tabBar?.custom).toBe(true);
    expect(app.tabBar?.list?.map(({ pagePath }) => pagePath)).toEqual([
      'pages/home/index',
      'pages/library/index',
      'pages/practical/index',
      'pages/profile/index',
    ]);
    for (const item of app.tabBar?.list ?? []) {
      expect(app.pages).toContain(item.pagePath);
    }

    assertUnitFiles(join(miniappRoot, 'custom-tab-bar', 'index'));
    assertComponentsResolve(join(miniappRoot, 'custom-tab-bar', 'index.json'));

    for (const component of [
      'analysis-panel',
      'app-topbar',
      'empty-state',
      'question-option',
      'stat-card',
    ]) {
      const componentPath = join(miniappRoot, 'components', component, 'index');
      assertUnitFiles(componentPath);
      assertComponentsResolve(`${componentPath}.json`);
    }
  });

  it('registers the shared topbar locally on every current secondary page', () => {
    const secondaryPages = [
      'library',
      'practice',
      'answer-sheet',
      'report',
      'question-list',
      'practical-detail',
    ];

    for (const page of secondaryPages) {
      const config = readJson<ComponentConfig>(join(miniappRoot, 'pages', page, 'index.json'));
      expect(config.usingComponents?.['app-topbar']).toBe('/components/app-topbar/index');
    }

    const app = readJson<ComponentConfig>(join(miniappRoot, 'app.json'));
    expect(app.usingComponents?.['app-topbar']).toBeUndefined();
  });

  it('ships six non-placeholder verified question shards', () => {
    const expectedShards = [
      'warehouse_l5.json',
      'warehouse_l4.json',
      'warehouse_l3.json',
      'inspector_l5.json',
      'inspector_l4.json',
      'inspector_l3.json',
    ];
    const ids = new Set<string>();

    for (const filename of expectedShards) {
      const records = readJson<Array<{ id: string; review_status: string }>>(
        join(miniappRoot, 'data', 'questions', filename),
      );
      expect(records.length, `${filename} needs at least 8 questions`).toBeGreaterThanOrEqual(8);
      expect(records.every(({ review_status }) => review_status === 'verified')).toBe(true);
      for (const { id } of records) {
        expect(ids.has(id), `duplicate runtime id: ${id}`).toBe(false);
        ids.add(id);
      }
    }

    expect(ids.size).toBe(61);
    expect(
      expectedShards.some((filename) =>
        readJson<Array<{ type: string }>>(join(miniappRoot, 'data', 'questions', filename)).some(
          ({ type }) => type === 'case',
        ),
      ),
    ).toBe(true);
  });
});
