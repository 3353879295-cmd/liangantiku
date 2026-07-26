import { describe, expect, it } from 'vitest';

import { resolveBackTarget } from '../miniprogram/presenters/navigation-presenter';

describe('resolveBackTarget', () => {
  it('uses the page stack when a previous page exists', () => {
    expect(resolveBackTarget(2, 'home')).toEqual({ type: 'navigateBack' });
  });

  it('falls back to the source main tab', () => {
    expect(resolveBackTarget(1, 'practical')).toEqual({
      type: 'switchTab',
      url: '/pages/practical/index',
    });
  });
});
