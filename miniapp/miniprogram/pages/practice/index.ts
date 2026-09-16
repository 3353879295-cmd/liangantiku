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
import { CERTIFICATES } from '../../data/certificates';
import { KNOWLEDGE_CATALOG } from '../../data/knowledge-catalog';
import { QUESTION_RECORDS } from '../../data/question-bank';
import { appServices } from '../../services/app-services';
import { MembershipError } from '../../repositories/membership-client';
import { presentMembership } from '../../presenters/membership-presenter';
import { PRACTICE_QUESTION_LIMITS, QUESTION_TYPES } from '../../types/domain';
import type {
  CertificateLevel,
  OccupationCode,
  PracticeMode,
  PracticeQuestionLimit,
  Question,
  QuestionType,
} from '../../types/domain';

const MODES = new Set<PracticeMode>([
  'chapter',
  'sequential',
  'random',
  'mock',
  'wrong',
  'favorite',
]);
const PRACTICE_LIMITS = new Set<string>(PRACTICE_QUESTION_LIMITS.map((limit) => String(limit)));
const QUESTION_TYPE_WHITELIST = new Set<string>(QUESTION_TYPES);
const NAVIGATION_ANIMATION_DURATION_MS = 180;

const belongsToCertificateCatalog = (
  occupation: OccupationCode,
  level: CertificateLevel,
  chapterId?: string,
  sectionId?: string,
): boolean => {
  if (chapterId && sectionId) return false;
  const chapters = KNOWLEDGE_CATALOG.occupations[occupation]?.parts
    .filter((part) => part.levels.includes(level))
    .flatMap((part) => part.chapters);
  if (!chapters) return false;
  if (chapterId) return chapters.some((chapter) => chapter.id === chapterId);
  if (sectionId)
    return chapters.some((chapter) => chapter.sections.some((section) => section.id === sectionId));
  return true;
};

const belongsToCertificateModule = (
  occupation: OccupationCode,
  level: CertificateLevel,
  module?: string,
): boolean =>
  !module ||
  QUESTION_RECORDS.some(
    (question) =>
      question.occupation === occupation && question.level === level && question.module === module,
  );

const hasMatchingRuntimeQuestion = (
  occupation: OccupationCode,
  level: CertificateLevel,
  module?: string,
  chapterId?: string,
  sectionId?: string,
): boolean =>
  QUESTION_RECORDS.some(
    (question) =>
      question.occupation === occupation &&
      question.level === level &&
      (!module || question.module === module) &&
      (!chapterId || question.chapter_id === chapterId) &&
      (!sectionId || question.section_id === sectionId),
  );

interface TouchPoint {
  x: number;
  y: number;
}

interface PracticeInteractionState {
  touchStartPoint: TouchPoint | null;
  navigationLocked: boolean;
  answerSheetNavigationPending: boolean;
  unlockTimer?: ReturnType<typeof setTimeout>;
}

const practiceInteractionStates = new WeakMap<object, PracticeInteractionState>();
const practiceRoutes = new WeakMap<object, Record<string, string | undefined>>();

const getPracticeInteractionState = (page: object): PracticeInteractionState => {
  const current = practiceInteractionStates.get(page);
  if (current) return current;
  const created: PracticeInteractionState = {
    touchStartPoint: null,
    navigationLocked: false,
    answerSheetNavigationPending: false,
  };
  practiceInteractionStates.set(page, created);
  return created;
};

const openAnswerSheet = (page: object): void => {
  const session = getActivePractice();
  const state = getPracticeInteractionState(page);
  if (!session || state.answerSheetNavigationPending) return;
  state.answerSheetNavigationPending = true;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    clearTimeout(timer);
    state.answerSheetNavigationPending = false;
  };
  const timer = setTimeout(release, 5000);
  const callbacks = { success: release, fail: release, complete: release };
  try {
    const result =
      session.status === 'submitted'
        ? wx.redirectTo({ url: '/pages/answer-sheet/index', ...callbacks })
        : wx.navigateTo({ url: '/pages/answer-sheet/index', ...callbacks });
    void Promise.resolve(result).catch(release);
  } catch {
    release();
  }
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
  const certificate = CERTIFICATES.find(
    (item) => item.occupation === occupation && item.level === level,
  );
  if (!certificate || certificate.availability !== 'available' || !MODES.has(mode)) return null;
  try {
    let limit: PracticeQuestionLimit | undefined;
    const rawLimit = options['limit'];
    if (mode === 'random') {
      if (rawLimit !== undefined && rawLimit !== '10') return null;
      limit = 10;
    } else if (rawLimit !== undefined) {
      if (!PRACTICE_LIMITS.has(rawLimit)) return null;
      limit = Number(rawLimit) as PracticeQuestionLimit;
    }

    let questionTypes: QuestionType[] | undefined;
    const rawTypes = options['types'];
    if (rawTypes !== undefined) {
      if (mode === 'random') return null;
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

    const module = options['module'] ? decodeURIComponent(options['module']) : undefined;
    const chapterId = options['chapterId'] ? decodeURIComponent(options['chapterId']) : undefined;
    const sectionId = options['sectionId'] ? decodeURIComponent(options['sectionId']) : undefined;
    if (
      !belongsToCertificateCatalog(occupation, level, chapterId, sectionId) ||
      !belongsToCertificateModule(occupation, level, module) ||
      ((module || chapterId || sectionId) &&
        !hasMatchingRuntimeQuestion(occupation, level, module, chapterId, sectionId))
    ) {
      return null;
    }

    return {
      resume: false,
      input: {
        occupation,
        level,
        mode,
        ...(limit !== undefined ? { limit } : {}),
        ...(questionTypes ? { questionTypes } : {}),
        ...(module ? { module } : {}),
        ...(chapterId ? { chapterId } : {}),
        ...(sectionId ? { sectionId } : {}),
      },
    } as const;
  } catch {
    return null;
  }
};

Page({
  data: {
    loading: true,
    freePracticeText: '',
    memberPromptVisible: false,
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
    multipleTipText: '',
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
    practiceRoutes.set(this, options);
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
    try {
      const session = route.resume ? await restorePractice(true) : await startPractice(route.input);
      if (practiceRoutes.get(this) !== options) return;
      if (!session) {
        this.setData({
          loading: false,
          errorTitle: '暂时没有可练习的题目',
          errorDescription: '可以切换证书等级，或先收藏一些题目后再练习。',
        });
        return;
      }
      this.renderSession(session);
      if (session.mode === 'random') void this.refreshMembership();
    } catch (error) {
      if (practiceRoutes.get(this) !== options) return;
      const membershipError = error instanceof MembershipError;
      this.setData({
        loading: false,
        errorTitle: membershipError ? '暂时无法开始练习' : '题目加载失败',
        errorDescription: membershipError ? error.message : '本地题库可能尚未同步，请返回后重试。',
        memberPromptVisible: membershipError && error.code === 'DAILY_LIMIT_REACHED',
      });
    }
  },

  onShow() {
    this.syncTheme();
    const session = getActivePractice();
    if (this.data.sessionReady && session) this.renderSession(session);
    if (this.data.sessionReady && session?.mode === 'random') void this.refreshMembership();
  },

  async refreshMembership() {
    const options = practiceRoutes.get(this);
    try {
      const status = await appServices.membership.getStatus();
      if (!options || practiceRoutes.get(this) !== options) return;
      this.setData({ freePracticeText: presentMembership(status).freePracticeText });
    } catch {
      if (!options || practiceRoutes.get(this) !== options) return;
      this.setData({ freePracticeText: '今日免费次数暂时无法查询' });
    }
  },

  onCloseMemberPrompt() {
    this.setData({ memberPromptVisible: false });
  },

  onRetryLoad() {
    const options = practiceRoutes.get(this);
    if (!options || this.data.loading) return;
    this.setData({ loading: true });
    void this.onLoad(options);
  },

  onOpenMember() {
    this.setData({ memberPromptVisible: false });
    void wx.navigateTo({ url: '/packages/auxiliary/pages/member/index' });
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
    const showConfirm =
      session.status === 'active' &&
      session.answerRevealMode === 'immediate' &&
      selectionMode === 'multiple' &&
      !feedback;
    const multipleTipText =
      session.status === 'active' && selectionMode === 'multiple'
        ? session.answerRevealMode === 'deferred'
          ? '本题可多选，可在交卷前修改'
          : showConfirm
            ? '本题有多个正确答案，选好后点击确认答案'
            : ''
        : '';
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
      showConfirm,
      multipleTipText,
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
      openAnswerSheet(this);
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
    openAnswerSheet(this);
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
    practiceRoutes.delete(this);
    const state = getPracticeInteractionState(this);
    if (state.unlockTimer !== undefined) clearTimeout(state.unlockTimer);
    practiceInteractionStates.delete(this);
  },
});
