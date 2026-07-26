import {
  getQuestionSelectionMode,
  presentQuestionOption,
  selectDraftOption,
} from '../../presenters/question-option-presenter';
import { confirmQuestionAnswer, navigateToQuestion } from '../../services/practice-session';
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
      session.mode === 'mock' ? session.status === 'submitted' : Boolean(feedback);
    const hasAnswer = Boolean(session.answers[question.id]);
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
        session.status === 'active' && (session.mode === 'mock' ? !hasAnswer : !revealAnswer),
      canConfirm: selected.length > 0,
      isMultiple: selectionMode === 'multiple',
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
    if (session.mode !== 'mock' && session.feedback[question.id]) return;
    const selectionMode = getQuestionSelectionMode(question.type, question.answer);
    const selected = selectDraftOption(this.data.draftSelection, event.detail.key, selectionMode);
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
    if (!this.data.draftSelection.length) {
      void wx.showToast({ title: '请至少选择一项', icon: 'none' });
      return;
    }
    const next = confirmQuestionAnswer(session, question.id, this.data.draftSelection, Date.now());
    saveActivePractice(next);
    this.renderSession(next);
  },

  onNext() {
    const session = getActivePractice();
    if (!session) return;
    if (this.data.isLast) {
      void wx.navigateTo({ url: '/pages/report/index' });
      return;
    }
    const next = navigateToQuestion(session, session.currentIndex + 1, Date.now());
    saveActivePractice(next);
    this.renderSession(next);
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
});
