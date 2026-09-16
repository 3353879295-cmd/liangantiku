import { afterEach, describe, expect, it, vi } from 'vitest';

import { makeQuestion } from './factories';
import type { PracticeSession } from '../miniprogram/services/practice-session';
import type { StorageAdapter } from '../miniprogram/types/domain';
import type { AnswerRevealMode, Question } from '../miniprogram/types/domain';

interface PracticePageData {
  draftSelection: string[];
  options: Array<{ key: string; selected: boolean; state: string; disabled: boolean }>;
  showConfirm: boolean;
  multipleTipText: string;
  analysisVisible: boolean;
  isLast: boolean;
  transitionClass: string;
}

interface PracticePageContext {
  data: PracticePageData;
  setData(update: Partial<PracticePageData>): void;
  renderSession: PracticePageDefinition['renderSession'];
  navigateRelative: PracticePageDefinition['navigateRelative'];
  syncTheme(): void;
  refreshMembership(): Promise<void>;
}

interface PracticePageDefinition {
  data: PracticePageData;
  renderSession(this: PracticePageContext, session: PracticeSession, draft?: string[]): void;
  onLoad(this: PracticePageContext, options: Record<string, string | undefined>): Promise<void>;
  onSelectOption(
    this: PracticePageContext,
    event: WechatMiniprogram.CustomEvent<{ key: string }>,
  ): void;
  onTouchStart(this: PracticePageContext, event: WechatMiniprogram.TouchEvent): void;
  onTouchEnd(this: PracticePageContext, event: WechatMiniprogram.TouchEvent): void;
  navigateRelative(this: PracticePageContext, offset: -1 | 1): void;
  onNext(this: PracticePageContext): void;
  onOpenAnswerSheet(this: PracticePageContext): void;
  onUnload(this: PracticePageContext): void;
}

interface NavigationOptions {
  url: string;
  success?: () => void;
  fail?: () => void;
  complete?: () => void;
}

class MemoryStorageAdapter implements StorageAdapter {
  private readonly values = new Map<string, unknown>();

  get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }

  remove(key: string): void {
    this.values.delete(key);
  }
}

const touchEvent = (
  start: { x: number; y: number } | null,
  end: { x: number; y: number } | null,
): WechatMiniprogram.TouchEvent =>
  ({
    touches: start ? [{ clientX: start.x, clientY: start.y }] : [],
    changedTouches: end ? [{ clientX: end.x, clientY: end.y }] : [],
  }) as unknown as WechatMiniprogram.TouchEvent;

const loadPracticePage = async (
  answerRevealMode: AnswerRevealMode,
  questions: readonly Question[],
) => {
  vi.resetModules();
  let definition: PracticePageDefinition | undefined;
  const navigateTo = vi.fn<(options: NavigationOptions) => void>();
  const redirectTo = vi.fn<(options: NavigationOptions) => void>();
  const pageScrollTo = vi.fn();

  vi.stubGlobal('Page', (value: PracticePageDefinition) => {
    definition = value;
  });
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    navigateTo,
    redirectTo,
    pageScrollTo,
    showToast: vi.fn(),
  });

  await import('../miniprogram/pages/practice/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  const runtime = await import('../miniprogram/services/practice-runtime');
  const practiceSession = await import('../miniprogram/services/practice-session');
  const { ProgressService } = await import('../miniprogram/services/progress-service');
  const { ProgressRepository, RECOVERY_BACKUP_KEY } =
    await import('../miniprogram/storage/progress-repository');
  if (!definition) throw new Error('practice Page was not registered');

  appServices.progress.updatePreferences({ answerRevealMode });
  const session = runtime.startPracticeFromQuestions(questions, 'sequential');
  if (!session) throw new Error('practice session was not created');

  const registered = definition;
  const context: PracticePageContext = {
    data: structuredClone(registered.data),
    setData(update) {
      Object.assign(this.data, update);
    },
    renderSession(sessionToRender, draft) {
      registered.renderSession.call(this, sessionToRender, draft);
    },
    navigateRelative(offset) {
      registered.navigateRelative.call(this, offset);
    },
    syncTheme() {},
    refreshMembership: () => Promise.resolve(),
  };
  registered.renderSession.call(context, session);
  const select = (key: string) =>
    registered.onSelectOption.call(context, {
      detail: { key },
    } as WechatMiniprogram.CustomEvent<{ key: string }>);

  return {
    context,
    definition: registered,
    navigateTo,
    pageScrollTo,
    practiceSession,
    ProgressRepository,
    ProgressService,
    RECOVERY_BACKUP_KEY,
    redirectTo,
    runtime,
    select,
  };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('practice page deferred selections', () => {
  it('uses explicit pending recovery only for a resume route', async () => {
    const { context, definition, runtime } = await loadPracticePage('immediate', [
      makeQuestion({ id: 'Q-resume' }),
    ]);
    const restore = vi.spyOn(runtime, 'restorePractice');
    await definition.onLoad.call(context, { resume: '1' });
    expect(restore).toHaveBeenCalledWith(true);
  });

  it.each([
    { label: 'multiple question', type: 'multiple' as const },
    { label: 'multi-answer case question', type: 'case' as const },
  ])('removes an empty $label answer and reloads all other learning state', async ({ type }) => {
    const target = makeQuestion({
      id: `Q-empty-${type}`,
      type,
      answer: ['A', 'C'],
    });
    const other = makeQuestion({ id: `Q-other-${type}` });
    const {
      context,
      definition,
      practiceSession,
      ProgressRepository,
      ProgressService,
      RECOVERY_BACKUP_KEY,
      runtime,
      select,
    } = await loadPracticePage('deferred', [target, other]);
    const started = runtime.getActivePractice();
    if (!started) throw new Error('active practice was not available');
    const withOtherAnswer = practiceSession.answerQuestion(started, other.id, ['A'], 1100);
    runtime.saveActivePractice(withOtherAnswer);
    definition.renderSession.call(context, withOtherAnswer);

    select('A');
    select('C');
    select('A');
    select('C');

    const active = runtime.getActivePractice();
    if (!active) throw new Error('active practice disappeared');
    const persisted = practiceSession.serializePracticeSession(active);
    const storage = new MemoryStorageAdapter();
    const service = new ProgressService(new ProgressRepository(storage));
    service.recordAnswer({
      questionId: 'Q-history',
      correct: true,
      durationMs: 500,
      at: '2026-07-25',
    });
    service.toggleFavorite('Q-favorite', 1200);
    service.updatePreferences({
      answerRevealMode: 'deferred',
      dailyGoal: 30,
      nickname: '麦穗',
    });
    service.saveSession(persisted);
    const reloaded = new ProgressService(new ProgressRepository(storage));

    expect({
      activeAnswer: active.answers[target.id],
      sheetStatuses: practiceSession.getAnswerSheet(active).map(({ status }) => status),
      persistedAnswer: persisted.answers[target.id],
      recoveryNotice: reloaded.consumeRecoveryNotice(),
      historyAnswered: reloaded.getDashboard('2026-07-25').answered,
      favorite: reloaded.isFavorite('Q-favorite'),
      preferences: reloaded.getPreferences(),
      restoredSession: reloaded.restoreSession(),
      recoveryBackup: storage.get(RECOVERY_BACKUP_KEY),
    }).toEqual({
      activeAnswer: undefined,
      sheetStatuses: ['unanswered', 'answered'],
      persistedAnswer: undefined,
      recoveryNotice: null,
      historyAnswered: 1,
      favorite: true,
      preferences: expect.objectContaining({
        answerRevealMode: 'deferred',
        dailyGoal: 30,
        nickname: '麦穗',
      }),
      restoredSession: expect.objectContaining({
        id: active.id,
        answers: { [other.id]: ['A'] },
      }),
      recoveryBackup: null,
    });
  });

  it.each([
    { type: 'multiple' as const, id: 'Q-tip-multiple' },
    { type: 'case' as const, id: 'Q-tip-case' },
  ])('shows an explicit multi-select hint for deferred $type questions', async ({ id, type }) => {
    const { context } = await loadPracticePage('deferred', [
      makeQuestion({ id, type, answer: ['A', 'C'] }),
    ]);

    expect(context.data.showConfirm).toBe(false);
    expect(context.data.multipleTipText).toContain('可多选');
  });

  it('keeps the immediate multiple confirmation hint and behavior', async () => {
    const { context } = await loadPracticePage('immediate', [
      makeQuestion({ id: 'Q-tip-immediate', type: 'multiple', answer: ['A', 'C'] }),
    ]);

    expect(context.data.showConfirm).toBe(true);
    expect(context.data.multipleTipText).toBe('本题有多个正确答案，选好后点击确认答案');
  });
});

describe('practice page gesture coordination', () => {
  it('does not navigate for a vertically dominant gesture', async () => {
    const { context, definition, pageScrollTo, runtime } = await loadPracticePage('deferred', [
      makeQuestion({ id: 'Q-vertical-1' }),
      makeQuestion({ id: 'Q-vertical-2' }),
    ]);

    definition.onTouchStart.call(context, touchEvent({ x: 120, y: 80 }, null));
    definition.onTouchEnd.call(context, touchEvent(null, { x: 90, y: 190 }));

    expect(runtime.getActivePractice()?.currentIndex).toBe(0);
    expect(context.data.transitionClass).toBe('');
    expect(pageScrollTo).not.toHaveBeenCalled();
  });

  it('rebounds at a boundary and keeps the 180ms lock before allowing navigation', async () => {
    vi.useFakeTimers();
    const { context, definition, pageScrollTo, runtime } = await loadPracticePage('deferred', [
      makeQuestion({ id: 'Q-boundary-1' }),
      makeQuestion({ id: 'Q-boundary-2' }),
    ]);

    definition.onTouchStart.call(context, touchEvent({ x: 40, y: 80 }, null));
    definition.onTouchEnd.call(context, touchEvent(null, { x: 120, y: 85 }));
    expect(context.data.transitionClass).toBe('practice-content--rebound-previous');

    definition.onTouchStart.call(context, touchEvent({ x: 120, y: 80 }, null));
    definition.onTouchEnd.call(context, touchEvent(null, { x: 40, y: 85 }));
    expect(runtime.getActivePractice()?.currentIndex).toBe(0);

    vi.advanceTimersByTime(179);
    expect(context.data.transitionClass).toBe('practice-content--rebound-previous');
    vi.advanceTimersByTime(1);
    expect(context.data.transitionClass).toBe('');

    definition.onTouchStart.call(context, touchEvent({ x: 120, y: 80 }, null));
    definition.onTouchEnd.call(context, touchEvent(null, { x: 40, y: 85 }));
    expect(runtime.getActivePractice()?.currentIndex).toBe(1);
    expect(pageScrollTo).toHaveBeenCalledWith({ scrollTop: 0, duration: 0 });
  });

  it('saves direct relative navigation, scrolls to the top, and clears its timer on unload', async () => {
    vi.useFakeTimers();
    const { context, definition, pageScrollTo, runtime } = await loadPracticePage('deferred', [
      makeQuestion({ id: 'Q-direct-1' }),
      makeQuestion({ id: 'Q-direct-2' }),
    ]);

    definition.navigateRelative.call(context, 1);

    expect(runtime.getActivePractice()?.currentIndex).toBe(1);
    expect(context.data.transitionClass).toBe('practice-content--next');
    expect(pageScrollTo).toHaveBeenCalledWith({ scrollTop: 0, duration: 0 });
    expect(vi.getTimerCount()).toBe(1);

    definition.onUnload.call(context);

    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('practice page answer-sheet navigation', () => {
  it('releases the answer-sheet lock after a missing callback or synchronous throw', async () => {
    vi.useFakeTimers();
    const { context, definition, navigateTo } = await loadPracticePage('deferred', [
      makeQuestion({ id: 'Q-navigation-timeout' }),
    ]);
    definition.onOpenAnswerSheet.call(context);
    definition.onOpenAnswerSheet.call(context);
    expect(navigateTo).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    navigateTo.mockImplementationOnce(() => {
      throw new Error('navigation failed');
    });
    definition.onOpenAnswerSheet.call(context);
    definition.onOpenAnswerSheet.call(context);
    expect(navigateTo).toHaveBeenCalledTimes(3);
    navigateTo.mock.calls[2]?.[0].complete?.();
  });

  it('locks duplicate active entries and unlocks after failure for retry', async () => {
    const { context, definition, navigateTo } = await loadPracticePage('deferred', [
      makeQuestion({ id: 'Q-active-route' }),
    ]);

    definition.onOpenAnswerSheet.call(context);
    definition.onOpenAnswerSheet.call(context);

    expect(navigateTo).toHaveBeenCalledTimes(1);
    const first = navigateTo.mock.calls[0]?.[0];
    expect(first).toMatchObject({
      url: '/pages/answer-sheet/index',
      success: expect.any(Function),
      fail: expect.any(Function),
      complete: expect.any(Function),
    });

    first?.fail?.();
    definition.onOpenAnswerSheet.call(context);
    expect(navigateTo).toHaveBeenCalledTimes(2);
  });

  it('replaces the submitted review page for both answer-sheet entry points', async () => {
    const { context, definition, navigateTo, redirectTo, runtime } = await loadPracticePage(
      'deferred',
      [makeQuestion({ id: 'Q-submitted-route' })],
    );
    const submitted = runtime.submitActivePractice(2000);
    if (!submitted) throw new Error('practice session was not submitted');
    definition.renderSession.call(context, submitted);

    definition.onOpenAnswerSheet.call(context);

    expect(redirectTo).toHaveBeenCalledTimes(1);
    expect(navigateTo).not.toHaveBeenCalled();
    redirectTo.mock.calls[0]?.[0].complete?.();

    definition.onNext.call(context);

    expect(redirectTo).toHaveBeenCalledTimes(2);
  });
});
