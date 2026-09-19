import { getPracticalSkill } from '../../../../data/practical-skills';
import { appServices } from '../../../../services/app-services';
import { startPracticeFromQuestions } from '../../../../services/practice-runtime';
import type { PracticalSkill } from '../../../../data/practical-skills';
import type { Question } from '../../../../types/domain';

const pendingRelatedLoads = new WeakSet<object>();
const pendingRelatedPracticeNavigations = new WeakSet<object>();
const retainedRelatedPractices = new WeakSet<object>();
const retainedRelatedPracticeSignatures = new WeakMap<object, string>();
const visibleDetails = new WeakSet<object>();

const getQuestionSignature = (questions: readonly Question[]) => JSON.stringify(questions);

const isPromise = (value: unknown): value is Promise<unknown> => value instanceof Promise;

const createRelatedPracticeNavigationCallbacks = (page: {
  setData(update: { startingRelatedPractice: boolean }): void;
}) => {
  let released = false;
  const release = (message?: string) => {
    if (released) return;
    released = true;
    clearTimeout(timeout);
    pendingRelatedPracticeNavigations.delete(page);
    if (visibleDetails.has(page)) {
      page.setData({ startingRelatedPractice: false });
      if (message) void wx.showToast({ title: message, icon: 'none' });
    }
  };
  const timeout = setTimeout(() => release('页面跳转超时，请重试'), 5000);
  return {
    success: () => {
      retainedRelatedPractices.delete(page);
      retainedRelatedPracticeSignatures.delete(page);
      release();
    },
    fail: () => release('页面跳转失败，请重试'),
    complete: () => release(),
  };
};

Page({
  data: {
    skill: null as PracticalSkill | null,
    roleText: '',
    sourceText: '',
    nonCurrentSourceText: '',
    relatedQuestions: [] as Question[],
    relatedReady: false,
    relatedLoadError: false,
    relatedLoading: false,
    startingRelatedPractice: false,
  },

  async onLoad(options: Record<string, string | undefined>) {
    visibleDetails.add(this);
    const skill = getPracticalSkill(String(options['id']));
    if (!skill) return;
    void wx.setNavigationBarTitle({ title: skill.title });
    this.setData({
      skill,
      roleText: skill.occupation === '4-02-06-01' ? '储粮保管' : '粮油质检',
      sourceText: skill.sourceIds.join(' · '),
      nonCurrentSourceText: skill.nonCurrentSourceIds?.join(' · ') ?? '',
    });
    await this.loadRelatedQuestions();
  },

  onUnload() {
    visibleDetails.delete(this);
    pendingRelatedLoads.delete(this);
    pendingRelatedPracticeNavigations.delete(this);
    retainedRelatedPractices.delete(this);
    retainedRelatedPracticeSignatures.delete(this);
  },

  async loadRelatedQuestions() {
    if (pendingRelatedLoads.has(this)) return;
    const skill = this.data.skill;
    if (!skill) return;
    pendingRelatedLoads.add(this);
    if (visibleDetails.has(this)) {
      this.setData({
        relatedQuestions: [],
        relatedReady: false,
        relatedLoadError: false,
        relatedLoading: true,
      });
    }
    try {
      const relatedQuestions = await appServices.questions.getByIds(skill.relatedQuestionIds);
      if (visibleDetails.has(this)) {
        const nextSignature = getQuestionSignature(relatedQuestions);
        if (retainedRelatedPracticeSignatures.get(this) !== nextSignature) {
          retainedRelatedPractices.delete(this);
          retainedRelatedPracticeSignatures.delete(this);
        }
        this.setData({
          relatedQuestions,
          relatedReady: true,
          relatedLoadError: false,
          relatedLoading: false,
        });
      }
    } catch {
      if (visibleDetails.has(this)) {
        this.setData({
          relatedQuestions: [],
          relatedReady: true,
          relatedLoadError: true,
          relatedLoading: false,
        });
      }
    } finally {
      pendingRelatedLoads.delete(this);
    }
  },

  async onRetryRelatedQuestions() {
    await this.loadRelatedQuestions();
  },

  onStartRelatedPractice() {
    if (
      !this.data.relatedReady ||
      this.data.relatedLoadError ||
      !this.data.relatedQuestions.length
    ) {
      void wx.showToast({ title: '相关题目尚未同步', icon: 'none' });
      return;
    }
    if (pendingRelatedPracticeNavigations.has(this)) return;
    const signature = getQuestionSignature(this.data.relatedQuestions);
    if (retainedRelatedPracticeSignatures.get(this) !== signature) {
      retainedRelatedPractices.delete(this);
      retainedRelatedPracticeSignatures.delete(this);
    }
    if (!retainedRelatedPractices.has(this)) {
      const session = startPracticeFromQuestions(this.data.relatedQuestions, 'chapter');
      if (!session) {
        void wx.showToast({ title: '暂时无法开始，请重试', icon: 'none' });
        return;
      }
      retainedRelatedPractices.add(this);
      retainedRelatedPracticeSignatures.set(this, signature);
    }
    pendingRelatedPracticeNavigations.add(this);
    this.setData({ startingRelatedPractice: true });
    const callbacks = createRelatedPracticeNavigationCallbacks(this);
    try {
      const result = wx.navigateTo({ url: '/pages/practice/index?resume=1', ...callbacks });
      const navigationResult: unknown = result;
      if (isPromise(navigationResult)) {
        void navigationResult.then(() => callbacks.success()).catch(() => callbacks.fail());
      }
    } catch {
      callbacks.fail();
    }
  },
});
