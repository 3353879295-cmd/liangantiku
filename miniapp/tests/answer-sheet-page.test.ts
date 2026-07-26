import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PracticeMode } from '../miniprogram/types/domain';

interface SubmitModalOptions {
  title: string;
  content: string;
  confirmText: string;
}

interface AnswerSheetPageModule {
  buildAnswerSheetSubmitModal?: (mode: PracticeMode, unanswered: number) => SubmitModalOptions;
}

const loadAnswerSheetPage = async (): Promise<AnswerSheetPageModule> => {
  vi.resetModules();
  vi.stubGlobal('Page', vi.fn());
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  });
  return import('../miniprogram/pages/answer-sheet/index');
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('answer-sheet submit modal', () => {
  it('uses the exact normal-practice action in the title and confirm button', async () => {
    const page = await loadAnswerSheetPage();

    expect(typeof page.buildAnswerSheetSubmitModal).toBe('function');
    expect(page.buildAnswerSheetSubmitModal?.('random', 3)).toEqual({
      title: '结束本次练习',
      content: '未答题 3 道，提交后将按未答处理。',
      confirmText: '结束本次练习',
    });
  });

  it('keeps the mock-exam submission wording distinct', async () => {
    const page = await loadAnswerSheetPage();

    expect(page.buildAnswerSheetSubmitModal?.('mock', 0)).toEqual({
      title: '确认交卷',
      content: '未答题 0 道，提交后将生成本次结果。',
      confirmText: '确认交卷',
    });
  });
});
