import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const readStyles = (path: string): string =>
  readFileSync(resolve(import.meta.dirname, '../miniprogram', path), 'utf8');

const practiceStyles = readStyles('pages/practice/index.wxss');
const themeStyles = readStyles('styles/tokens.wxss');

const colorsFor = (styles: string, selector: string): Record<string, string> => {
  const block = styles.split(`${selector} {`)[1]?.split('}')[0];
  if (!block) throw new Error(`Missing palette: ${selector}`);
  const palette: Record<string, string> = {};
  for (const [, key, color] of block.matchAll(/(--[\w-]+):\s*(#[\da-f]{3,6});/giu)) {
    if (key && color) palette[key] = color;
  }
  return palette;
};

const luminance = (hex: string): number => {
  const normalized = hex.length === 4 ? hex.replace(/[^#]/gu, '$&$&') : hex;
  const channels = [1, 3, 5].map((offset) => {
    const channel = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
};

const contrast = (foreground: string, background: string): number => {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

describe.each([
  ['light', '.practice-page', 'page'],
  ['night', '.practice-page.theme-night', '.theme-night'],
])('answer readability in %s mode', (_theme, practiceSelector, themeSelector) => {
  const practice = colorsFor(practiceStyles, practiceSelector);
  const theme = colorsFor(themeStyles, themeSelector);

  it.each(['selected', 'correct', 'wrong'])(
    'keeps %s text, badges and borders distinct',
    (state) => {
      const color = (part: string): string => {
        const value = practice[`--practice-option-${state}-${part}`];
        if (!value) throw new Error(`Missing ${state} ${part} color`);
        return value;
      };

      expect(
        contrast(color('text'), color('background')),
        'option and status text',
      ).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color('key-text'), color('accent')), 'letter badge').toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(color('accent'), color('background')), 'state border').toBeGreaterThanOrEqual(
        3,
      );
    },
  );

  it('keeps unselected options and result summaries readable', () => {
    expect(
      contrast(theme['--color-option-text']!, theme['--color-surface']!),
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(theme['--color-option-text']!, theme['--color-surface-secondary']!),
    ).toBeGreaterThanOrEqual(4.5);
    for (const color of ['--color-success-readable', '--color-danger-readable']) {
      expect(contrast(theme[color]!, theme['--color-bg']!), color).toBeGreaterThanOrEqual(4.5);
    }
  });
});
