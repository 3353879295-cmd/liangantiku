interface ToastComponent {
  data: {
    visible: boolean;
  };
  triggerEvent(name: string): void;
}

const hideTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const detachedComponents = new WeakSet<object>();

const clearHideTimer = (component: object): void => {
  const timer = hideTimers.get(component);
  if (timer === undefined) return;
  clearTimeout(timer);
  hideTimers.delete(component);
};

const syncHideTimer = (component: ToastComponent, visible = component.data.visible): void => {
  clearHideTimer(component);
  if (!visible || detachedComponents.has(component)) return;

  const timer = setTimeout(() => {
    hideTimers.delete(component);
    if (detachedComponents.has(component)) return;
    component.triggerEvent('close');
  }, 1600);
  hideTimers.set(component, timer);
};

Component({
  properties: {
    visible: {
      type: Boolean,
      value: false,
      observer(visible: boolean) {
        syncHideTimer(this, visible);
      },
    },
    message: {
      type: String,
      value: '',
      observer() {
        syncHideTimer(this);
      },
    },
  },
  lifetimes: {
    attached() {
      detachedComponents.delete(this);
    },
    detached() {
      detachedComponents.add(this);
      clearHideTimer(this);
    },
  },
});

export {};
