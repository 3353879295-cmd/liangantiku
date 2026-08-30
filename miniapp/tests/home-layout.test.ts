import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const homeRoot = resolve(import.meta.dirname, '..', 'miniprogram', 'pages', 'home');
const markup = readFileSync(join(homeRoot, 'index.wxml'), 'utf8');
const styles = readFileSync(join(homeRoot, 'index.wxss'), 'utf8');

const rule = (selector: string): string =>
  styles.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`, 's'))?.[1] ?? '';

describe('home action layout contract', () => {
  it('keeps chapter and favorites together while clearing the fixed tab bar', () => {
    expect(markup).toContain('action-card--{{item.id}}');
    expect(rule('.action-card--chapter')).toMatch(/grid-column:\s*1;/);
    expect(rule('.action-card--chapter')).toMatch(/grid-row:\s*1;/);
    expect(rule('.action-card--favorite')).toMatch(/grid-column:\s*2;/);
    expect(rule('.action-card--favorite')).toMatch(/grid-row:\s*1;/);
    expect(rule('.action-card--random')).toMatch(/grid-column:\s*1\s*\/\s*-1;/);
    expect(rule('.action-card--random')).toMatch(/grid-row:\s*2;/);
    expect(styles).toMatch(
      /\.home-page\s*\{[^}]*padding-bottom:\s*calc\(160rpx\s*\+\s*env\(safe-area-inset-bottom\)\);/s,
    );
  });
});
