interface TabBar {
  setData(data: { membershipPromptVisible: boolean }): void;
}

interface MembershipPromptInstance {
  data: { visible: boolean };
  getTabBar?: () => TabBar | undefined;
  triggerEvent(name: 'close' | 'confirm'): void;
  syncTabBarVisibility(): void;
  setTabBarVisibility(visible: boolean): void;
}

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(this: MembershipPromptInstance, visible: boolean) {
        this.setTabBarVisibility(visible);
      },
    },
  },
  lifetimes: {
    ready(this: MembershipPromptInstance) {
      this.syncTabBarVisibility();
    },
    detached(this: MembershipPromptInstance) {
      this.setTabBarVisibility(false);
    },
  },
  pageLifetimes: {
    show(this: MembershipPromptInstance) {
      this.syncTabBarVisibility();
    },
    hide(this: MembershipPromptInstance) {
      this.setTabBarVisibility(false);
    },
  },
  methods: {
    syncTabBarVisibility(this: MembershipPromptInstance) {
      this.setTabBarVisibility(this.data.visible);
    },
    setTabBarVisibility(this: MembershipPromptInstance, visible: boolean) {
      this.getTabBar?.()?.setData({ membershipPromptVisible: visible });
    },
    close(this: MembershipPromptInstance) {
      this.triggerEvent('close');
    },
    confirm(this: MembershipPromptInstance) {
      this.triggerEvent('confirm');
    },
  },
});
