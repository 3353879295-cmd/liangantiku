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
const TAB_VALUES = new Set(TABS.map((tab) => tab.value));

interface TabBarContext {
  data: { value: string };
  setData(update: { value: string }): void;
}

const tabBarInstances = new Set<TabBarContext>();
let switching = false;
let queuedTarget: string | undefined;
let activeRequest = 0;
let watchdog: ReturnType<typeof setTimeout> | undefined;

export const TAB_SWITCH_WATCHDOG_MS = 1500;

const currentRoute = (): string | undefined => {
  const pages = getCurrentPages();
  const currentPage = pages[pages.length - 1];
  return currentPage?.route ? `/${currentPage.route}` : undefined;
};

const setValue = (component: TabBarContext, value: string): void => {
  if (!tabBarInstances.has(component) || component.data.value === value) return;
  component.setData({ value });
};

const syncAllCurrentRoute = (): void => {
  const value = currentRoute();
  if (value) tabBarInstances.forEach((component) => setValue(component, value));
};

export const syncCurrentRoute = (component: TabBarContext): void => {
  const value = currentRoute();
  if (value && (!tabBarInstances.has(component) || component.data.value !== value)) {
    component.setData({ value });
  }
};

const clearWatchdog = (): void => {
  if (watchdog !== undefined) clearTimeout(watchdog);
  watchdog = undefined;
};

const startNextSwitch = (): void => {
  if (switching) return;

  const target = queuedTarget;
  queuedTarget = undefined;
  if (!target) return;
  if (target === currentRoute()) {
    syncAllCurrentRoute();
    startNextSwitch();
    return;
  }

  switching = true;
  const request = ++activeRequest;
  const settle = (): void => {
    if (!switching || request !== activeRequest) return;
    switching = false;
    clearWatchdog();
    syncAllCurrentRoute();
    startNextSwitch();
  };

  watchdog = setTimeout(settle, TAB_SWITCH_WATCHDOG_MS);
  try {
    const result: unknown = wx.switchTab({
      url: target,
      success: settle,
      fail: settle,
      complete: settle,
    });
    if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
      void Promise.resolve(result).then(settle, settle);
    }
  } catch {
    settle();
  }
};

Component({
  data: {
    value: TABS[0]?.value ?? '/pages/home/index',
    tabs: TABS,
  },
  lifetimes: {
    attached() {
      tabBarInstances.add(this);
      syncCurrentRoute(this);
    },
    detached() {
      tabBarInstances.delete(this);
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
      if (!value || !TAB_VALUES.has(value)) return;
      if (value === currentRoute()) {
        if (switching) queuedTarget = value;
        syncAllCurrentRoute();
        return;
      }

      tabBarInstances.forEach((component) => setValue(component, value));
      queuedTarget = value;
      startNextSwitch();
    },
  },
});
