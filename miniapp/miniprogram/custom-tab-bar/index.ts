interface TabItem {
  text: string;
  value: string;
  icon: string;
}

const TABS: TabItem[] = [
  { text: '首页', value: '/pages/home/index', icon: '⌂' },
  { text: '实操', value: '/pages/practical/index', icon: '⚒' },
  { text: '我的', value: '/pages/profile/index', icon: '◉' },
];

interface TabBarContext {
  setData(update: { value: string }): void;
}

export const syncCurrentRoute = (component: TabBarContext): void => {
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  if (currentPage?.route) component.setData({ value: `/${currentPage.route}` });
};

Component({
  data: {
    value: TABS[0]?.value ?? '/pages/home/index',
    tabs: TABS,
  },
  lifetimes: {
    attached() {
      syncCurrentRoute(this);
    },
  },
  pageLifetimes: {
    show() {
      syncCurrentRoute(this);
    },
  },
  methods: {
    onTabTap(event: WechatMiniprogram.BaseEvent) {
      const value = event.currentTarget.dataset.value as string | undefined;
      if (!value || value === this.data.value) return;

      this.setData({ value });
      void wx.switchTab({ url: value });
    },
  },
});
