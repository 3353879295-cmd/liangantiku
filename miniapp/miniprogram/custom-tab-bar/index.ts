interface TabItem {
  text: string;
  value: string;
  icon: string;
}

const TABS: TabItem[] = [
  { text: '首页', value: '/pages/home/index', icon: 'home' },
  { text: '实操', value: '/pages/practical/index', icon: 'tools' },
  { text: '我的', value: '/pages/profile/index', icon: 'user' },
];

Component({
  data: {
    value: TABS[0]?.value ?? '/pages/home/index',
    tabs: TABS,
  },
  lifetimes: {
    attached() {
      const pages = getCurrentPages();
      const currentPage = pages[pages.length - 1];
      if (currentPage?.route) {
        this.setData({ value: `/${currentPage.route}` });
      }
    },
  },
  methods: {
    onChange(event: WechatMiniprogram.CustomEvent<{ value: string }>) {
      this.setData({ value: event.detail.value });
    },
  },
});
