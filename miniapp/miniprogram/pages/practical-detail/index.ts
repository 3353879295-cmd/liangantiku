import { getPracticalSkill } from '../../data/practical-skills';
import { appServices } from '../../services/app-services';
import { startPracticeFromQuestions } from '../../services/practice-runtime';
import type { PracticalSkill } from '../../data/practical-skills';
import type { Question } from '../../types/domain';

Page({
  data: {
    skill: null as PracticalSkill | null,
    sourceText: '',
    relatedQuestions: [] as Question[],
    relatedReady: false,
  },

  async onLoad(options: Record<string, string | undefined>) {
    const skill = getPracticalSkill(String(options['id']));
    if (!skill) return;
    void wx.setNavigationBarTitle({ title: skill.title });
    this.setData({ skill, sourceText: skill.sourceIds.join(' · ') });
    const relatedQuestions = await appServices.questions.getByIds(skill.relatedQuestionIds);
    this.setData({ relatedQuestions, relatedReady: true });
  },

  onStartRelatedPractice() {
    if (!this.data.relatedQuestions.length) {
      void wx.showToast({ title: '相关题目尚未同步', icon: 'none' });
      return;
    }
    startPracticeFromQuestions(this.data.relatedQuestions, 'chapter');
    void wx.navigateTo({ url: '/pages/practice/index?resume=1' });
  },
});
