import { resolveBackTarget } from '../../presenters/navigation-presenter';
import type { MainTab } from '../../presenters/navigation-presenter';

Component({
  properties: {
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    fallbackTab: { type: String, value: 'home' },
    showBack: { type: Boolean, value: true },
  },
  methods: {
    handleBack() {
      const target = resolveBackTarget(getCurrentPages().length, this.data.fallbackTab as MainTab);

      if (target.type === 'navigateBack') {
        void wx.navigateBack();
        return;
      }

      void wx.switchTab({ url: target.url });
    },
  },
});
