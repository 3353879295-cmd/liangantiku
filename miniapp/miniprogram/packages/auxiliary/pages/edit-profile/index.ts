import { appServices } from '../../../../services/app-services';

const avatarOptions = [
  { id: 'wheat', label: '麦穗', url: '/assets/avatars/wheat.svg' },
  { id: 'granary', label: '粮仓', url: '/assets/avatars/granary.svg' },
  { id: 'field', label: '田野', url: '/assets/avatars/field.svg' },
  { id: 'book', label: '教材', url: '/assets/avatars/book.svg' },
] as const;

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    avatarOptions,
  },

  onShow() {
    const preferences = appServices.progress.getPreferences();
    this.setData({
      nickname: preferences.nickname,
      avatarUrl: preferences.avatarUrl,
    });
  },

  onNicknameInput(event: WechatMiniprogram.Input) {
    this.setData({ nickname: event.detail.value });
  },

  onAvatarTap(event: WechatMiniprogram.TouchEvent) {
    const avatarUrl = String(event.currentTarget.dataset['avatarUrl'] ?? '');
    if (!avatarOptions.some(({ url }) => url === avatarUrl)) return;
    this.setData({ avatarUrl });
  },

  onSave() {
    const nickname = this.data.nickname.trim();
    if (!nickname) {
      void wx.showToast({ title: '请输入昵称', icon: 'none' });
      return;
    }
    if (nickname.length > 12) {
      void wx.showToast({ title: '昵称最多 12 个字', icon: 'none' });
      return;
    }

    appServices.progress.updatePreferences({
      nickname,
      avatarUrl: this.data.avatarUrl,
    });
    void wx.showToast({ title: '资料已保存', icon: 'success' });
    void wx.navigateBack();
  },
});
