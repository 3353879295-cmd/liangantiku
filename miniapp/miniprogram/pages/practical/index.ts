import { PRACTICAL_SKILLS } from '../../data/practical-skills';

Page({
  data: {
    groups: [
      {
        title: '储粮保管',
        note: '6 项 · 巡查、仓房、通风与安全',
        skills: PRACTICAL_SKILLS.filter((skill) => skill.occupation === '4-02-06-01'),
      },
      {
        title: '粮油质检',
        note: '6 项 · 扦样、制样、检验与记录',
        skills: PRACTICAL_SKILLS.filter((skill) => skill.occupation === '4-08-05-01'),
      },
    ],
  },

  onShow() {
    this.getTabBar()?.setData({ value: '/pages/practical/index' });
  },

  onOpenSkill(event: WechatMiniprogram.TouchEvent) {
    const id = String(event.currentTarget.dataset['id']);
    if (id) void wx.navigateTo({ url: `/pages/practical-detail/index?id=${id}` });
  },
});
