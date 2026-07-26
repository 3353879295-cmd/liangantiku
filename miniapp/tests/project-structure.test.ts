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

  it('renders the current textbook as linked chapter cards without certificate or mode selectors', () => {
    const libraryMarkup = readFileSync(join(miniappRoot, 'pages', 'library', 'index.wxml'), 'utf8');

    for (const binding of [
      '<app-topbar',
      '{{chapter.sectionCountText}}',
      '{{chapter.questionCountText}}',
      '{{chapter.progressText}}',
      '{{chapter.accuracyText}}',
      '{{chapter.wrongText}}',
      'bind:tap="onChapterTap"',
    ]) {
      expect(libraryMarkup).toContain(binding);
    }
    expect(libraryMarkup).not.toContain('certificate-chip');
    expect(libraryMarkup).not.toContain('mode-grid');
    expect(libraryMarkup).not.toContain('onSelectCertificate');
  });

  it('renders chapter detail status and gates chapter practice on real availability', () => {
    const detailMarkup = readFileSync(
      join(miniappRoot, 'pages', 'chapter-detail', 'index.wxml'),
      'utf8',
    );

    for (const binding of [
      '<app-topbar',
      '{{chapter.questionCountText}}',
      '{{chapter.progressText}}',
      '{{section.statusText}}',
      'bind:tap="onSectionPractice"',
      'wx:if="{{chapter.canStart}}"',
      'bind:tap="onChapterPractice"',
    ]) {
      expect(detailMarkup).toContain(binding);
    }
  });

  it('guards real practice setup counts and actions until repository loading finishes', () => {
    for (const page of ['random-settings', 'mock-info']) {
      const markup = readFileSync(join(miniappRoot, 'pages', page, 'index.wxml'), 'utf8');
      const loadingGuardIndex = markup.indexOf('wx:if="{{loading}}"');
      const loadedContentIndex = markup.indexOf('<block wx:else>');

      expect(loadingGuardIndex, `${page} needs a neutral loading branch`).toBeGreaterThan(-1);
      expect(loadedContentIndex, `${page} needs a loaded-content branch`).toBeGreaterThan(
        loadingGuardIndex,
      );
      expect(markup).toContain('subtitle="{{loading ? \'正在读取当前题库\' : bankTitle}}"');
    }

    const randomMarkup = readFileSync(
      join(miniappRoot, 'pages', 'random-settings', 'index.wxml'),
      'utf8',
    );
    const randomLoadedContent = randomMarkup.indexOf('<block wx:else>');
    expect(randomMarkup.indexOf('{{bankQuestionCount}}')).toBeGreaterThan(randomLoadedContent);
    expect(randomMarkup.indexOf('{{summaryText}}')).toBeGreaterThan(randomLoadedContent);

    const mockMarkup = readFileSync(join(miniappRoot, 'pages', 'mock-info', 'index.wxml'), 'utf8');
    const mockLoadedContent = mockMarkup.indexOf('<block wx:else>');
    expect(mockMarkup.indexOf('{{questionCount}}')).toBeGreaterThan(mockLoadedContent);
    expect(mockMarkup.indexOf('{{questionCountText}}')).toBeGreaterThan(mockLoadedContent);
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

    expect(app.pages).toHaveLength(12);
    for (const page of app.pages) {
      const pagePath = join(miniappRoot, page);
      assertUnitFiles(pagePath);
      assertComponentsResolve(`${pagePath}.json`);
    }

    expect(app.tabBar?.custom).toBe(true);
    expect(app.tabBar?.list?.map(({ pagePath }) => pagePath)).toEqual([
      'pages/home/index',
      'pages/practical/index',
      'pages/profile/index',
    ]);
    expect(app.pages).toContain('pages/library/index');
    expect(app.pages).toContain('pages/chapter-detail/index');
    expect(app.pages).toContain('pages/random-settings/index');
    expect(app.pages).toContain('pages/mock-info/index');
    for (const item of app.tabBar?.list ?? []) {
      expect(app.pages).toContain(item.pagePath);
    }

    assertUnitFiles(join(miniappRoot, 'custom-tab-bar', 'index'));
    assertComponentsResolve(join(miniappRoot, 'custom-tab-bar', 'index.json'));
    const customTabBar = readFileSync(join(miniappRoot, 'custom-tab-bar', 'index.ts'), 'utf8');
    expect(customTabBar).not.toContain('pages/library/index');

    for (const component of [
      'analysis-panel',
      'app-topbar',
      'certificate-selector',
      'empty-state',
      'question-option',
      'stat-card',
    ]) {
      const componentPath = join(miniappRoot, 'components', component, 'index');
      assertUnitFiles(componentPath);
      assertComponentsResolve(`${componentPath}.json`);
    }

    const home = readJson<ComponentConfig>(join(miniappRoot, 'pages', 'home', 'index.json'));
    expect(home.usingComponents?.['certificate-selector']).toBe(
      '/components/certificate-selector/index',
    );
  });

  it('registers the shared topbar locally on every current secondary page', () => {
    const secondaryPages = [
      'library',
      'chapter-detail',
      'random-settings',
      'mock-info',
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

  it('keeps the emphasized random action in presenter order while spanning the full grid row', () => {
    const homeStyles = readFileSync(join(miniappRoot, 'pages', 'home', 'index.wxss'), 'utf8');
    const actionRule = homeStyles.match(/\.action-card\s*\{([^}]*)\}/s)?.[1];
    const emphasizedRule = homeStyles.match(/\.action-card--emphasized\s*\{([^}]*)\}/s)?.[1];

    expect(actionRule).not.toMatch(/\border\s*:/);
    expect(emphasizedRule).not.toMatch(/\border\s*:/);
    expect(emphasizedRule).toMatch(/grid-column:\s*1\s*\/\s*-1;/);
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
