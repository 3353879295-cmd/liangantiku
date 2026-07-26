import { appServices } from '../../services/app-services';
import type { AnswerTheme } from '../../types/domain';

const goalValues = [10, 20, 30, 50] as const;
const themeValues = new Set<AnswerTheme>(['light', 'night']);

const presentGoals = (selected: number) =>
  goalValues.map((value) => ({
    value,
    label: `${value} 题`,
    selected: value === selected,
  }));

const presentThemes = (selected: AnswerTheme) => [
  {
    value: 'light' as const,
    title: '明亮主题',
    note: '浅色背景，适合光线充足的环境',
    selected: selected === 'light',
  },
  {
    value: 'night' as const,
    title: '护眼深色',
    note: '深色答题界面，适合较暗环境',
    selected: selected === 'night',
  },
];

Page({
  data: {
    dailyGoal: 20,
    answerTheme: 'light',
    goalOptions: presentGoals(20),
    themeOptions: presentThemes('light'),
  },

  onShow() {
    const preferences = appServices.progress.getPreferences();
    this.setData({
      dailyGoal: preferences.dailyGoal,
      answerTheme: preferences.answerTheme,
      goalOptions: presentGoals(preferences.dailyGoal),
      themeOptions: presentThemes(preferences.answerTheme),
    });
  },

  onGoalTap(event: WechatMiniprogram.TouchEvent) {
    const dailyGoal = Number(event.currentTarget.dataset['goal']);
    if (!goalValues.some((value) => value === dailyGoal)) return;

    appServices.progress.updatePreferences({ dailyGoal });
    this.setData({
      dailyGoal,
      goalOptions: presentGoals(dailyGoal),
    });
    void wx.showToast({ title: `每日目标已设为 ${dailyGoal} 题`, icon: 'none' });
  },

  onThemeTap(event: WechatMiniprogram.TouchEvent) {
    const answerTheme = String(event.currentTarget.dataset['theme']) as AnswerTheme;
    if (!themeValues.has(answerTheme)) return;

    appServices.theme.set(answerTheme);
    this.setData({
      answerTheme,
      themeOptions: presentThemes(answerTheme),
    });
    void wx.showToast({ title: '答题主题已更新', icon: 'none' });
  },
});
