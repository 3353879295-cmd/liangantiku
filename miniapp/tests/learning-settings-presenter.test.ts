import { afterEach, describe, expect, it, vi } from 'vitest';

import { presentRevealModes } from '../miniprogram/presenters/learning-settings-presenter';
import type { AnswerRevealMode } from '../miniprogram/types/domain';

interface RevealModeOption {
  value: AnswerRevealMode;
  title: string;
  selected: boolean;
}

interface LearningSettingsData {
  answerRevealMode: AnswerRevealMode;
  revealModeOptions: RevealModeOption[];
}

interface LearningSettingsContext {
  data: LearningSettingsData;
  setData(update: Partial<LearningSettingsData>): void;
}

interface LearningSettingsDefinition {
  data: LearningSettingsData;
  onShow(this: LearningSettingsContext): void;
  onRevealModeTap(
    this: LearningSettingsContext,
    event: Pick<WechatMiniprogram.TouchEvent, 'currentTarget'>,
  ): void;
}

const loadLearningSettingsPage = async () => {
  vi.resetModules();
  let definition: LearningSettingsDefinition | undefined;
  const showToast = vi.fn();

  vi.stubGlobal('Page', (value: LearningSettingsDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    showToast,
  });

  await import('../miniprogram/pages/learning-settings/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  if (!definition) throw new Error('learning-settings Page was not registered');

  const registered = definition;
  const context: LearningSettingsContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
  };

  const eventFor = (
    answerRevealMode: unknown,
  ): Pick<WechatMiniprogram.TouchEvent, 'currentTarget'> => ({
    currentTarget: {
      id: '',
      offsetTop: 0,
      offsetLeft: 0,
      dataset: { revealMode: answerRevealMode },
    },
  });

  return { appServices, context, definition: registered, eventFor, showToast };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('learning settings reveal-mode presenter', () => {
  it('presents exactly the two supported modes with immediate selected', () => {
    expect(presentRevealModes('immediate')).toEqual([
      { value: 'immediate', title: '即时解析', selected: true },
      { value: 'deferred', title: '交卷后解析', selected: false },
    ]);
  });

  it('selects only deferred when that preference is saved', () => {
    expect(presentRevealModes('deferred')).toEqual([
      { value: 'immediate', title: '即时解析', selected: false },
      { value: 'deferred', title: '交卷后解析', selected: true },
    ]);
  });
});

describe('learning settings reveal-mode page', () => {
  it('loads the saved reveal mode whenever the page is shown', async () => {
    const { appServices, context, definition } = await loadLearningSettingsPage();
    appServices.progress.updatePreferences({ answerRevealMode: 'deferred' });

    definition.onShow.call(context);

    expect(context.data.answerRevealMode).toBe('deferred');
    expect(context.data.revealModeOptions.map(({ selected }) => selected)).toEqual([false, true]);
  });

  it('persists a valid mode for the next practice and confirms the change', async () => {
    const { appServices, context, definition, eventFor, showToast } =
      await loadLearningSettingsPage();

    definition.onRevealModeTap.call(context, eventFor('deferred'));

    expect(appServices.progress.getPreferences().answerRevealMode).toBe('deferred');
    expect(context.data.answerRevealMode).toBe('deferred');
    expect(context.data.revealModeOptions.map(({ selected }) => selected)).toEqual([false, true]);
    expect(showToast).toHaveBeenCalledWith({
      title: '解析方式已更新，下次练习生效',
      icon: 'none',
    });
  });

  it('ignores unsupported dataset values without changing the saved preference', async () => {
    const { appServices, context, definition, eventFor, showToast } =
      await loadLearningSettingsPage();

    definition.onRevealModeTap.call(context, eventFor('instant'));

    expect(appServices.progress.getPreferences().answerRevealMode).toBe('immediate');
    expect(context.data.answerRevealMode).toBe('immediate');
    expect(showToast).not.toHaveBeenCalled();
  });
});
