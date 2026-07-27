import {
  getQuestionSelectionMode,
  presentQuestionOption,
  selectDraftOption,
} from '../../presenters/question-option-presenter';
import { resolvePracticeSwipe } from '../../presenters/practice-swipe-presenter';
import {
  answerQuestion,
  confirmQuestionAnswer,
  navigateToQuestion,
} from '../../services/practice-session';
import {
  getActivePractice,
  restorePractice,
  saveActivePractice,
  startPractice,
} from '../../services/practice-runtime';
import { appServices } from '../../services/app-services';
import { PRACTICE_QUESTION_LIMITS, QUESTION_TYPES } from '../../types/domain';
import type {
  CertificateLevel,
  OccupationCode,
  PracticeMode,
  PracticeQuestionLimit,
  Question,
  QuestionType,
} from '../../types/domain';

const OCCUPATIONS = new Set<OccupationCode>(['4-02-06-01', '4-08-05-01']);
const LEVELS = new Set<CertificateLevel>([5, 4, 3]);
const MODES = new Set<PracticeMode>([
  'chapter',
  'sequential',
  'random',
  'mock',
  'wrong',
  'favorite',
]);
const PRACTICE_LIMITS = new Set<string>(PRACTICE_QUESTION_LIMITS.map((limit) => String(limit)));
const RANDOM_LIMITS = new Set<PracticeQuestionLimit>([10, 20, 30]);
const QUESTION_TYPE_WHITELIST = new Set<string>(QUESTION_TYPES);
const NAVIGATION_ANIMATION_DURATION_MS = 180;

interface TouchPoint {
  x: number;
  y: number;
}

interface PracticeInteractionState {
  touchStartPoint: TouchPoint | null;
  navigationLocked: boolean;
  unlockTimer?: ReturnType<typeof setTimeout>;
}

const practiceInteractionStates = new WeakMap<object, PracticeInteractionState>();

const getPracticeInteractionState = (page: object): PracticeInteractionState => {
  const current = practiceInteractionStates.get(page);
  if (current) return current;
  const created: PracticeInteractionState = {
    touchStartPoint: null,
    navigationLocked: false,
  };
  practiceInteractionStates.set(page, created);
  return created;
};

const MODE_LABELS: Record<PracticeMode, string> = {
  chapter: '章节练习',
  sequential: '顺序练习',
  random: '随机练习',
  mock: '模拟考试',
  wrong: '错题重练',
  favorite: '收藏练习',
};

const TYPE_LABELS: Record<Question['type'], string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  case: '案例题',
};

export const parsePracticeRoute = (options: Record<string, string | undefined>) => {
  if (options['resume'] === '1') return { resume: true } as const;
  const occupation = options['occupation'] as OccupationCode;
  const level = Number(options['level']) as CertificateLevel;
  const mode = options['mode'] as PracticeMode;
  if (!OCCUPATIONS.has(occupation) || !LEVELS.has(level) || !MODES.has(mode)) return null;
  try {
    let limit: PracticeQuestionLimit | undefined;
    const rawLimit = options['limit'];
    if (rawLimit !== undefined) {
      if (!PRACTICE_LIMITS.has(rawLimit)) return null;
      limit = Number(rawLimit) as PracticeQuestionLimit;
      if (mode === 'random' && !RANDOM_LIMITS.has(limit)) return null;
    }

    let questionTypes: QuestionType[] | undefined;
    const rawTypes = options['types'];
    if (rawTypes !== undefined) {
      const decodedTypes = decodeURIComponent(rawTypes).split(',');
      if (
        !decodedTypes.length ||
        decodedTypes.some(
          (questionType) => !questionType || !QUESTION_TYPE_WHITELIST.has(questionType),
        )
      ) {
        return null;
      }
      questionTypes = [...new Set(decodedTypes)] as QuestionType[];
    }

    return {
      resume: false,
      input: {
        occupation,
        level,
        mode,
        ...(limit !== undefined ? { limit } : {}),
        ...(questionTypes ? { questionTypes } : {}),
        ...(options['module'] ? { module: decodeURIComponent(options['module']) } : {}),
        ...(options['chapterId'] ? { chapterId: decodeURIComponent(options['chapterId']) } : {}),
        ...(options['sectionId'] ? { sectionId: decodeURIComponent(options['sectionId']) } : {}),
      },
    } as const;
  } catch {
    return null;
  }
};

Page({
  data: {
    loading: true,
    sessionReady: false,
    errorTitle: '',
    errorDescription: '',
    modeLabel: '',
    indexText: '',
    progressPercent: 0,
    question: null as Question | null,
    questionTypeLabel: '',
    options: [] as Array<Question['options'][number] & ReturnType<typeof presentQuestionOption>>,
    draftSelection: [] as string[],
    showConfirm: true,
    canConfirm: false,
    isMultiple: false,
    isFirst: true,
    isLast: false,
    analysisVisible: false,
    analysisCorrect: false,
    selectedText: '',
    expectedText: '',
    favorite: false,
    theme: 'light',
    themeClass: '',
    toastVisible: false,
    toastMessage: '',
    transitionClass: '',
  },

  async onLoad(options: Record<string, string | undefined>) {
    this.syncTheme();
    const route = parsePracticeRoute(options);
    if (!route) {
      this.setData({
        loading: false,
        errorTitle: '练习参数不正确',
        errorDescription: '请返回题库重新选择练习方式。',
      });
      return;
    }
    void wx.showLoading({ title: '正在准备题目', mask: true });
    try {
      const session = route.resume ? await restorePractice() : await startPractice(route.input);
      if (!session) {
        this.setData({
          loading: false,
          errorTitle: '暂时没有可练习的题目',
          errorDescription: '可以切换证书等级，或先收藏一些题目后再练习。',
        });
        return;
      }
      this.renderSession(session);
    } catch {
      this.setData({
        loading: false,
        errorTitle: '题目加载失败',
        errorDescription: '本地题库可能尚未同步，请返回后重试。',
      });
    } finally {
      void wx.hideLoading();
    }
  },

  onShow() {
    this.syncTheme();
    const session = getActivePractice();
    if (this.data.sessionReady && session) this.renderSession(session);
  },

  syncTheme() {
    const theme = appServices.theme.get();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
  },

  renderSession(session: NonNullable<ReturnType<typeof getActivePractice>>, draft?: string[]) {
    const question = session.questions[session.currentIndex];
    if (!question) return;
    const selected = draft ?? session.answers[question.id] ?? [];
    const feedback = session.feedback[question.id];
    const revealAnswer =
      session.status === 'submitted' ||
      (session.answerRevealMode === 'immediate' && Boolean(feedback));
    const selectionMode = getQuestionSelectionMode(question.type, question.answer);
    this.setData({
      loading: false,
      sessionReady: true,
      errorTitle: '',
      modeLabel: MODE_LABELS[session.mode],
      indexText: `${session.currentIndex + 1} / ${session.questions.length}`,
      progressPercent: Math.round(((session.currentIndex + 1) / session.questions.length) * 100),
      question,
      questionTypeLabel: TYPE_LABELS[question.type],
      options: question.options.map((option) => ({
        ...option,
        ...presentQuestionOption({
          key: option.key,
          selected: selected.includes(option.key),
          revealAnswer,
          correctKeys: question.answer,
        }),
      })),
      draftSelection: selected,
      showConfirm:
        session.status === 'active' &&
        session.answerRevealMode === 'immediate' &&
        selectionMode === 'multiple' &&
        !feedback,
      canConfirm: selected.length > 0,
      isMultiple: selectionMode === 'multiple',
      isFirst: session.currentIndex === 0,
      isLast: session.currentIndex === session.questions.length - 1,
      analysisVisible: revealAnswer && Boolean(feedback),
      analysisCorrect: feedback?.correct ?? false,
      selectedText: selected.join('、') || '未作答',
      expectedText: question.answer.join('、'),
      favorite: appServices.progress.isFavorite(question.id),
    });
  },

  onSelectOption(event: WechatMiniprogram.CustomEvent<{ key: string }>) {
    const session = getActivePractice();
    const question = session?.questions[session.currentIndex];
    if (!session || !question || session.status === 'submitted') return;
    if (session.answerRevealMode === 'immediate' && session.feedback[question.id]) return;
    const selectionMode = getQuestionSelectionMode(question.type, question.answer);
    const selected = selectDraftOption(this.data.draftSelection, event.detail.key, selectionMode);

    if (session.answerRevealMode === 'deferred') {
      const next = answerQuestion(session, question.id, selected, Date.now());
      saveActivePractice(next);
      this.renderSession(next);
      return;
    }

    if (selectionMode === 'single') {
      const next = confirmQuestionAnswer(session, question.id, selected, Date.now());
      saveActivePractice(next);
      this.renderSession(next);
      return;
    }

    const options = question.options.map((option) => ({
      ...option,
      ...presentQuestionOption({
        key: option.key,
        selected: selected.includes(option.key),
        revealAnswer: false,
        correctKeys: question.answer,
      }),
    }));
    this.setData({
      draftSelection: selected,
      selectedText: selected.join('、') || '未作答',
      showConfirm: true,
      canConfirm: selected.length > 0,
      options,
    });
  },

  onConfirmAnswer() {
    const session = getActivePractice();
    const question = session?.questions[session.currentIndex];
    if (!session || !question || session.status === 'submitted') return;
    if (
      session.answerRevealMode !== 'immediate' ||
      getQuestionSelectionMode(question.type, question.answer) !== 'multiple' ||
      session.feedback[question.id]
    ) {
      return;
    }
    if (!this.data.draftSelection.length) {
      void wx.showToast({ title: '请至少选择一项', icon: 'none' });
      return;
    }
    const next = confirmQuestionAnswer(session, question.id, this.data.draftSelection, Date.now());
    saveActivePractice(next);
    this.renderSession(next);
  },

  onTouchStart(event: WechatMiniprogram.TouchEvent) {
    const touch = event.touches[0];
    if (!touch) return;
    getPracticeInteractionState(this).touchStartPoint = {
      x: touch.clientX,
      y: touch.clientY,
    };
  },

  onTouchEnd(event: WechatMiniprogram.TouchEvent) {
    const state = getPracticeInteractionState(this);
    const start = state.touchStartPoint;
    state.touchStartPoint = null;
    const touch = event.changedTouches[0];
    const session = getActivePractice();
    if (!start || !touch || !session || state.navigationLocked) return;

    const deltaX = touch.clientX - start.x;
    const deltaY = touch.clientY - start.y;
    const swipe = resolvePracticeSwipe({
      deltaX,
      deltaY,
      currentIndex: session.currentIndex,
      total: session.questions.length,
    });

    if (swipe.boundary) {
      state.navigationLocked = true;
      this.setData({
        transitionClass:
          deltaX > 0 ? 'practice-content--rebound-previous' : 'practice-content--rebound-next',
      });
      state.unlockTimer = setTimeout(() => {
        state.navigationLocked = false;
        this.setData({ transitionClass: '' });
      }, NAVIGATION_ANIMATION_DURATION_MS);
      return;
    }

    if (swipe.direction === 'previous') this.navigateRelative(-1);
    if (swipe.direction === 'next') this.navigateRelative(1);
  },

  onPrevious() {
    this.navigateRelative(-1);
  },

  onNext() {
    const session = getActivePractice();
    const state = getPracticeInteractionState(this);
    if (!session || state.navigationLocked) return;
    if (this.data.isLast) {
      state.navigationLocked = true;
      void wx.navigateTo({ url: '/pages/answer-sheet/index' });
      state.unlockTimer = setTimeout(() => {
        state.navigationLocked = false;
      }, NAVIGATION_ANIMATION_DURATION_MS);
      return;
    }
    this.navigateRelative(1);
  },

  navigateRelative(offset: -1 | 1) {
    const state = getPracticeInteractionState(this);
    const session = getActivePractice();
    if (!session || state.navigationLocked) return;
    const targetIndex = session.currentIndex + offset;
    if (targetIndex < 0 || targetIndex >= session.questions.length) return;

    state.navigationLocked = true;
    this.setData({
      transitionClass: offset < 0 ? 'practice-content--previous' : 'practice-content--next',
    });
    const next = navigateToQuestion(session, targetIndex, Date.now());
    saveActivePractice(next);
    this.renderSession(next);
    void wx.pageScrollTo({ scrollTop: 0, duration: 0 });
    state.unlockTimer = setTimeout(() => {
      state.navigationLocked = false;
      this.setData({ transitionClass: '' });
    }, NAVIGATION_ANIMATION_DURATION_MS);
  },

  onOpenAnswerSheet() {
    void wx.navigateTo({ url: '/pages/answer-sheet/index' });
  },

  onToggleTheme() {
    const theme = appServices.theme.toggle();
    this.setData({
      theme,
      themeClass: theme === 'night' ? 'theme-night' : '',
    });
  },

  onToggleFavorite() {
    const question = this.data.question;
    if (!question) return;
    const favorite = appServices.progress.toggleFavorite(question.id, Date.now());
    this.setData({
      favorite,
      toastMessage: favorite ? '已收藏' : '已取消收藏',
      toastVisible: true,
    });
  },

  onToastClose() {
    this.setData({ toastVisible: false });
  },

  onUnload() {
    const state = getPracticeInteractionState(this);
    if (state.unlockTimer !== undefined) clearTimeout(state.unlockTimer);
    practiceInteractionStates.delete(this);
  },
});
