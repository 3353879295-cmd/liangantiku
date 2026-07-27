import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';

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
    list?: Array<{ pagePath: string; text: string }>;
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

const assertComponentsResolve = (configPath: string, visited = new Set<string>()) => {
  if (visited.has(configPath)) return;
  visited.add(configPath);

  const config = readJson<ComponentConfig>(configPath);
  for (const componentPath of Object.values(config.usingComponents ?? {})) {
    if (componentPath.startsWith('/') || componentPath.startsWith('.')) {
      const localComponent = componentPath.startsWith('/')
        ? join(miniappRoot, componentPath.slice(1))
        : resolve(dirname(configPath), componentPath);
      assertUnitFiles(localComponent);
      assertComponentsResolve(`${localComponent}.json`, visited);
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

const collectSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      return entry === 'miniprogram_npm' ? [] : collectSourceFiles(path);
    }
    return ['.json', '.ts', '.wxml', '.wxss'].includes(extname(path)) ? [path] : [];
  });

const wxmlImageSourcePattern = /<image\b[^>]*?\ssrc\s*=\s*(["'])(.*?)\1[^>]*>/gs;
const nonLocalImageSourcePattern = /^(?:\/\/|[a-z][a-z\d+.-]*:)/i;

const assertLocalImagePath = (sourcePath: string, assetPath: string): void => {
  const trimmedAssetPath = assetPath.trim();
  expect(trimmedAssetPath, `${sourcePath} has an empty literal image source`).not.toBe('');
  expect(
    trimmedAssetPath,
    `${sourcePath} uses a remote or embedded image: ${trimmedAssetPath}`,
  ).not.toMatch(nonLocalImageSourcePattern);
  const localAssetPath = trimmedAssetPath.split(/[?#]/u, 1)[0] ?? '';
  const resolvedAsset = localAssetPath.startsWith('/')
    ? join(miniappRoot, localAssetPath.slice(1))
    : resolve(dirname(sourcePath), localAssetPath);
  expect(existsSync(resolvedAsset), `${sourcePath} references missing ${assetPath}`).toBe(true);
  expect(statSync(resolvedAsset).isFile(), `${resolvedAsset} is not a file`).toBe(true);
};

const assertWxmlImageSourcesAreLocal = (sourcePath: string, source: string): number => {
  const assetPaths = [...source.matchAll(wxmlImageSourcePattern)]
    .map((match) => match[2] ?? '')
    .filter((assetPath) => !assetPath.includes('{{') && !assetPath.includes('}}'));

  for (const assetPath of assetPaths) assertLocalImagePath(sourcePath, assetPath);
  return assetPaths.length;
};

const readPngSize = (path: string) => {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  };
};

const readLossyWebpSize = (path: string) => {
  const bytes = readFileSync(path);
  expect(bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
  expect(bytes.subarray(12, 16).toString('ascii')).toBe('VP8 ');
  expect(bytes.subarray(23, 26)).toEqual(Buffer.from([0x9d, 0x01, 0x2a]));
  return {
    width: bytes.readUInt16LE(26) & 0x3fff,
    height: bytes.readUInt16LE(28) & 0x3fff,
  };
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
    const visitedComponents = new Set<string>();

    expect(app.pages).toHaveLength(16);
    for (const page of app.pages) {
      const pagePath = join(miniappRoot, page);
      assertUnitFiles(pagePath);
      assertComponentsResolve(`${pagePath}.json`, visitedComponents);
    }

    expect(app.tabBar?.custom).toBe(true);
    expect(app.tabBar?.list).toEqual([
      { pagePath: 'pages/home/index', text: '首页' },
      { pagePath: 'pages/practical/index', text: '实操' },
      { pagePath: 'pages/profile/index', text: '我的' },
    ]);
    expect(app.pages).toContain('pages/library/index');
    expect(app.pages).toContain('pages/chapter-detail/index');
    expect(app.pages).toContain('pages/random-settings/index');
    expect(app.pages).toContain('pages/mock-info/index');
    expect(app.pages).toContain('pages/learning-report/index');
    expect(app.pages).toContain('pages/member/index');
    expect(app.pages).toContain('pages/edit-profile/index');
    expect(app.pages).toContain('pages/learning-settings/index');
    for (const item of app.tabBar?.list ?? []) {
      expect(app.pages).toContain(item.pagePath);
    }

    assertUnitFiles(join(miniappRoot, 'custom-tab-bar', 'index'));
    assertComponentsResolve(join(miniappRoot, 'custom-tab-bar', 'index.json'), visitedComponents);
    assertComponentsResolve(join(miniappRoot, 'app.json'), visitedComponents);
    const customTabBar = readFileSync(join(miniappRoot, 'custom-tab-bar', 'index.ts'), 'utf8');
    expect([...customTabBar.matchAll(/value: '([^']+)'/g)].map((match) => match[1])).toEqual([
      '/pages/home/index',
      '/pages/practical/index',
      '/pages/profile/index',
    ]);
    expect([...customTabBar.matchAll(/text: '([^']+)'/g)].map((match) => match[1])).toEqual([
      '首页',
      '实操',
      '我的',
    ]);

    const registeredLocalComponents = [...visitedComponents]
      .filter((configPath) => configPath.startsWith(join(miniappRoot, 'components')))
      .map((configPath) => configPath.slice(0, -'.json'.length))
      .sort();
    const shippedLocalComponents = readdirSync(join(miniappRoot, 'components'))
      .map((component) => join(miniappRoot, 'components', component, 'index'))
      .sort();
    expect(registeredLocalComponents).toEqual(shippedLocalComponents);

    const home = readJson<ComponentConfig>(join(miniappRoot, 'pages', 'home', 'index.json'));
    expect(home.usingComponents?.['certificate-selector']).toBe(
      '/components/certificate-selector/index',
    );
  });

  it('renders mutually exclusive expanded and collapsed certificate selector views', () => {
    const markup = readFileSync(
      join(miniappRoot, 'components', 'certificate-selector', 'index.wxml'),
      'utf8',
    );
    const styles = readFileSync(
      join(miniappRoot, 'components', 'certificate-selector', 'index.wxss'),
      'utf8',
    );

    expect(markup).toContain('wx:if="{{collapsed}}"');
    expect(markup).toContain('wx:else');
    expect(markup).toContain('{{summaryText}}');
    expect(markup).toContain('重新选择');
    expect(markup).toContain('bind:tap="onExpand"');
    expect(markup).toContain('aria-label="当前题库 {{summaryText}}，重新选择"');
    expect(markup).toContain('class="selector-panel selector-panel--expanded"');
    expect(markup).toContain('class="role-options"');
    expect(markup).toContain('class="level-options"');
    expect(markup).toContain('class="collapsed-action__chevron"');
    expect(markup).not.toMatch(/[▼▽↓⌄]/u);
    expect(styles).toMatch(/\.collapsed-action__chevron\s*\{[^}]*border-right:/s);
    expect(styles).toMatch(/\.collapsed-action__chevron\s*\{[^}]*border-bottom:/s);
    expect(styles).toMatch(/\.collapsed-action__chevron\s*\{[^}]*rotate\(45deg\)/s);
  });

  it('keeps literal WXML image sources local and resolvable', () => {
    const referenceCount = collectSourceFiles(miniappRoot)
      .filter((sourcePath) => extname(sourcePath) === '.wxml')
      .reduce(
        (count, sourcePath) =>
          count + assertWxmlImageSourcesAreLocal(sourcePath, readFileSync(sourcePath, 'utf8')),
        0,
      );

    expect(referenceCount).toBeGreaterThan(0);
  });

  it.each([
    ['data URI', 'data:image/svg+xml;base64,PHN2Zy8+'],
    ['extensionless remote URL', 'https://example.com/avatar'],
    ['protocol-relative remote URL', '//cdn.example.com/avatar'],
    ['blob URL', 'blob:https://example.com/avatar-id'],
    ['other non-local scheme', 'ftp://example.com/avatar'],
  ])('rejects a literal WXML image source using a %s', (_label, assetPath) => {
    expect(() =>
      assertWxmlImageSourcesAreLocal(
        join(miniappRoot, 'contract-fixture.wxml'),
        `<image src="${assetPath}" />`,
      ),
    ).toThrow(/remote or embedded image/);
  });

  it('does not treat similarly named WXML data attributes as image sources', () => {
    expect(
      assertWxmlImageSourcesAreLocal(
        join(miniappRoot, 'contract-fixture.wxml'),
        '<image data-src="https://example.com/lazy-image" />',
      ),
    ).toBe(0);
  });

  it('keeps the current practical icon and selectable avatar collections local', () => {
    const practicalSourcePath = join(miniappRoot, 'data', 'practical-skills.ts');
    const practicalSource = readFileSync(practicalSourcePath, 'utf8');
    const practicalAssets = [...practicalSource.matchAll(/\biconAsset:\s*'([^']+)'/g)].map(
      (match) => match[1] ?? '',
    );
    expect(practicalAssets).toHaveLength(12);
    for (const assetPath of practicalAssets) {
      assertLocalImagePath(practicalSourcePath, assetPath);
    }

    const avatarSourcePath = join(miniappRoot, 'pages', 'edit-profile', 'index.ts');
    const avatarSource = readFileSync(avatarSourcePath, 'utf8');
    const avatarAssets = [...avatarSource.matchAll(/\burl:\s*'([^']+)'/g)].map(
      (match) => match[1] ?? '',
    );
    expect(avatarAssets).toHaveLength(4);
    for (const assetPath of avatarAssets) {
      assertLocalImagePath(avatarSourcePath, assetPath);
    }
  });

  it('wires practice theme and custom favorite feedback through local components', () => {
    const practiceConfig = readJson<ComponentConfig>(
      join(miniappRoot, 'pages', 'practice', 'index.json'),
    );
    expect(practiceConfig.usingComponents).toMatchObject({
      'app-toast': '/components/app-toast/index',
      'favorite-button': '/components/favorite-button/index',
      'theme-toggle': '/components/theme-toggle/index',
    });

    const practiceMarkup = readFileSync(
      join(miniappRoot, 'pages', 'practice', 'index.wxml'),
      'utf8',
    );
    expect(practiceMarkup).toContain('class="practice-page {{themeClass}}"');
    expect(practiceMarkup).toContain('<app-topbar');
    expect(practiceMarkup).toContain('<theme-toggle');
    expect(practiceMarkup).toContain('<favorite-button');
    expect(practiceMarkup).toContain('<app-toast');

    const favoriteMarkup = readFileSync(
      join(miniappRoot, 'components', 'favorite-button', 'index.wxml'),
      'utf8',
    );
    expect(favoriteMarkup.match(/<view\s+class="favorite-button__ripple /g)).toHaveLength(1);
  });

  it('wires practice touch navigation and keeps previous and next button fallbacks', () => {
    const practiceMarkup = readFileSync(
      join(miniappRoot, 'pages', 'practice', 'index.wxml'),
      'utf8',
    );
    const practiceSource = readFileSync(join(miniappRoot, 'pages', 'practice', 'index.ts'), 'utf8');

    expect(practiceMarkup).toMatch(
      /<view\s+class="practice-content \{\{transitionClass\}\}"[^>]*\bbindtouchstart="onTouchStart"[^>]*\bbindtouchend="onTouchEnd"/s,
    );
    expect(practiceMarkup).toMatch(/<button[^>]*\bbindtap="onPrevious"[^>]*>上一题<\/button>/s);
    expect(practiceMarkup).toMatch(/<button[^>]*\bbindtap="onNext"[^>]*>/s);
    expect(practiceSource).toContain('onTouchStart(');
    expect(practiceSource).toContain('onTouchEnd(');
    expect(practiceSource).toContain('navigateRelative(');
  });

  it('keeps submitted practice review read-only with whole-paper navigation', () => {
    const practiceMarkup = readFileSync(
      join(miniappRoot, 'pages', 'practice', 'index.wxml'),
      'utf8',
    );
    const practiceSource = readFileSync(join(miniappRoot, 'pages', 'practice', 'index.ts'), 'utf8');

    expect(practiceMarkup).toContain('disabled="{{item.disabled}}"');
    expect(practiceMarkup).toMatch(/<button[^>]*\bbindtap="onPrevious"[^>]*>上一题<\/button>/s);
    expect(practiceMarkup).toMatch(/<button[^>]*\bbindtap="onNext"[^>]*>/s);
    expect(practiceSource).toContain("session.status === 'submitted'");
    expect(practiceSource).toContain('analysisVisible: revealAnswer && Boolean(feedback)');
  });

  it('opens the submitted answer sheet from the result page before wrong-only review', () => {
    const reportMarkup = readFileSync(join(miniappRoot, 'pages', 'report', 'index.wxml'), 'utf8');
    const reportSource = readFileSync(join(miniappRoot, 'pages', 'report', 'index.ts'), 'utf8');
    const answerSheetPosition = reportMarkup.indexOf('查看答题卡');
    const wrongReviewPosition = reportMarkup.indexOf('查看本次错题解析');

    expect(answerSheetPosition).toBeGreaterThan(-1);
    expect(wrongReviewPosition).toBeGreaterThan(answerSheetPosition);
    expect(reportMarkup).toMatch(
      /<button[^>]*class="primary-button"[^>]*bindtap="onOpenAnswerSheet"[^>]*>查看答题卡<\/button>/s,
    );
    expect(reportSource).toContain('onOpenAnswerSheet()');
    expect(reportSource).toContain("url: '/pages/answer-sheet/index'");
  });

  it('pins the approved option readability and touch geometry values', () => {
    const styles = readFileSync(
      join(miniappRoot, 'components', 'question-option', 'index.wxss'),
      'utf8',
    );
    const optionRule = styles.match(/\.option\s*\{([^}]*)\}/s)?.[1] ?? '';
    const textRule = styles.match(/\.option__text\s*\{([^}]*)\}/s)?.[1] ?? '';

    expect(optionRule).toMatch(/\bmin-height:\s*96rpx;/);
    expect(optionRule).toMatch(/\bborder-radius:\s*34rpx;/);
    expect(textRule).toMatch(/\bfont-size:\s*28rpx;/);
    expect(textRule).toMatch(/\bfont-weight:\s*600;/);
    expect(textRule).toMatch(/\bline-height:\s*1\.5;/);
  });

  it('wires the shared review pages to the persistent theme controls and topbar', () => {
    for (const page of ['answer-sheet', 'report', 'question-list']) {
      const config = readJson<ComponentConfig>(join(miniappRoot, 'pages', page, 'index.json'));
      expect(config.usingComponents).toMatchObject({
        'app-topbar': '/components/app-topbar/index',
        'theme-toggle': '/components/theme-toggle/index',
      });

      const markup = readFileSync(join(miniappRoot, 'pages', page, 'index.wxml'), 'utf8');
      expect(markup, `${page} needs a themed root`).toContain('{{themeClass}}');
      expect(markup, `${page} needs the shared topbar`).toContain('<app-topbar');
      expect(markup, `${page} needs the theme toggle`).toContain('<theme-toggle');

      const source = readFileSync(join(miniappRoot, 'pages', page, 'index.ts'), 'utf8');
      expect(source, `${page} must use the persistent theme service`).toContain(
        'appServices.theme',
      );
      expect(source).not.toContain('wx.getStorageSync');
      expect(source).not.toContain('wx.setStorageSync');
    }
  });

  it('keeps analysis details in the required reading order with a real correction entry', () => {
    const analysisMarkup = readFileSync(
      join(miniappRoot, 'components', 'analysis-panel', 'index.wxml'),
      'utf8',
    );
    const labels = ['你的答案', '正确答案', '题目解析', '知识点', '易错原因', '标准依据'];

    const positions = labels.map((label) => analysisMarkup.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
    expect(analysisMarkup).not.toContain('wx:if="{{commonMistake}}"');
    expect(analysisMarkup).toContain('本题暂无单独易错提示，请结合题目解析复习。');
    expect(analysisMarkup).toContain('open-type="feedback"');
    expect(analysisMarkup).toContain('bindtap="handleCopyQuestionId"');

    const practiceMarkup = readFileSync(
      join(miniappRoot, 'pages', 'practice', 'index.wxml'),
      'utf8',
    );
    expect(practiceMarkup).toContain('selected-text="{{selectedText}}"');
    expect(practiceMarkup).toContain('question-id="{{question.id}}"');
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
      'learning-report',
      'member',
      'edit-profile',
      'learning-settings',
    ];

    for (const page of secondaryPages) {
      const config = readJson<ComponentConfig>(join(miniappRoot, 'pages', page, 'index.json'));
      expect(config.usingComponents?.['app-topbar']).toBe('/components/app-topbar/index');
    }

    const app = readJson<ComponentConfig>(join(miniappRoot, 'app.json'));
    expect(app.usingComponents?.['app-topbar']).toBeUndefined();
  });

  it('keeps profile focused on progress and account actions without duplicate review entries', () => {
    const markup = readFileSync(join(miniappRoot, 'pages', 'profile', 'index.wxml'), 'utf8');
    const source = readFileSync(join(miniappRoot, 'pages', 'profile', 'index.ts'), 'utf8');

    for (const label of ['编辑资料', '会员权益', '学习报告', '学习设置', '数据管理', '意见反馈']) {
      expect(markup).toContain(label);
    }
    expect(markup).toContain('open-type="feedback"');
    expect(markup).not.toContain('>复习<');
    expect(markup).not.toContain('错题本');
    expect(markup).not.toContain('收藏试题');
    expect(source).not.toContain('onOpenWrong');
    expect(source).not.toContain('onOpenFavorite');

    const orderedLabels = [
      '编辑资料',
      '会员权益',
      '累计练习',
      '今日目标',
      '近七天',
      '学习报告',
      '学习设置',
      '数据管理',
      '意见反馈',
    ];
    const positions = orderedLabels.map((label) => markup.indexOf(label));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it('shows both answer reveal choices in learning settings', () => {
    const markup = readFileSync(
      join(miniappRoot, 'pages', 'learning-settings', 'index.wxml'),
      'utf8',
    );

    for (const copy of [
      '答案与解析',
      '即时解析',
      '交卷后解析',
      '单选与判断选中即看解析，多选确认后看解析',
      '答题时不显示正误，交卷后统一查看',
    ]) {
      expect(markup).toContain(copy);
    }
    expect(markup).toContain('data-reveal-mode="{{item.value}}"');
    expect(markup).toContain('bindtap="onRevealModeTap"');
  });

  it('wires profile secondary pages to existing services and truthful platform capabilities', () => {
    const editSource = readFileSync(join(miniappRoot, 'pages', 'edit-profile', 'index.ts'), 'utf8');
    const settingsSource = readFileSync(
      join(miniappRoot, 'pages', 'learning-settings', 'index.ts'),
      'utf8',
    );
    const reportSource = readFileSync(
      join(miniappRoot, 'pages', 'learning-report', 'index.ts'),
      'utf8',
    );
    const memberMarkup = readFileSync(join(miniappRoot, 'pages', 'member', 'index.wxml'), 'utf8');

    expect(editSource).toContain('appServices.progress.updatePreferences');
    expect(editSource).toContain('/assets/avatars/');
    expect(editSource).not.toContain('chooseAvatar');
    expect(editSource).not.toContain('chooseMedia');
    expect(settingsSource).toContain('appServices.progress.updatePreferences');
    expect(settingsSource).toContain('appServices.theme.set');
    expect(reportSource).toContain('appServices.progress.getDashboard');
    expect(reportSource).toContain('appServices.progress.getActivity');
    expect(reportSource).toContain('appServices.progress.getQuestionProgress');
    expect(reportSource).toContain('presentCatalogParts');
    expect(memberMarkup).toContain('功能逐步开放');
    expect(memberMarkup).toContain('name="book-open"');
    expect(memberMarkup).not.toContain('name="books"');
    expect(memberMarkup).not.toContain('requestPayment');
    expect(memberMarkup).not.toContain('立即支付');
    expect(memberMarkup).not.toContain('立即开通');

    for (const source of [editSource, settingsSource, reportSource]) {
      expect(source).not.toContain('wx.getStorageSync');
      expect(source).not.toContain('wx.setStorageSync');
    }
  });

  it('ships substantial local practical artwork and references it without remote URLs', () => {
    const practicalAssetRoot = join(miniappRoot, 'assets', 'practical');
    const icons = [
      'warehouse.png',
      'thermometer.png',
      'grain-pest.png',
      'sampler.png',
      'moisture-test.png',
    ];

    const heroPath = join(practicalAssetRoot, 'rice-ear-hero.webp');
    expect(existsSync(heroPath)).toBe(true);
    expect(readFileSync(heroPath).byteLength).toBeGreaterThan(40_000);
    expect(readFileSync(heroPath).byteLength).toBeLessThan(100_000);
    const heroSize = readLossyWebpSize(heroPath);
    expect(heroSize.width).toBeGreaterThan(heroSize.height);
    expect(heroSize.width / heroSize.height).toBeGreaterThanOrEqual(1.5);

    for (const icon of icons) {
      const iconPath = join(practicalAssetRoot, icon);
      expect(existsSync(iconPath), `${icon} is missing`).toBe(true);
      expect(readFileSync(iconPath).byteLength, `${icon} is a placeholder`).toBeGreaterThan(500);
      const size = readPngSize(iconPath);
      expect(size.width).toBe(size.height);
      expect(size.width).toBeGreaterThanOrEqual(96);
    }

    const practicalMarkup = readFileSync(
      join(miniappRoot, 'pages', 'practical', 'index.wxml'),
      'utf8',
    );
    expect(practicalMarkup).toContain('<image');
    expect(practicalMarkup).toContain('src="{{skill.iconAsset}}"');
    expect(practicalMarkup).not.toContain('name="{{skill.icon}}"');

    const detailMarkup = readFileSync(
      join(miniappRoot, 'pages', 'practical-detail', 'index.wxml'),
      'utf8',
    );
    expect(detailMarkup).toContain('<app-topbar');
    expect(detailMarkup).toContain('/assets/practical/rice-ear-hero.webp');
    expect(detailMarkup).not.toMatch(/https?:\/\//);
    expect(detailMarkup).toContain('现行知识依据');
    expect(detailMarkup).toContain('历史/书目参考（非现行依据）');

    const sectionPositions = [
      '作业目的',
      '作业准备',
      '操作步骤',
      '安全提示',
      '常见错误',
      '关联练习',
    ].map((label) => detailMarkup.indexOf(label));
    expect(sectionPositions.every((position) => position >= 0)).toBe(true);
    expect(sectionPositions).toEqual([...sectionPositions].sort((left, right) => left - right));
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
