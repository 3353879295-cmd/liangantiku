const keyPopTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();

const clearKeyPopTimer = (component: object): void => {
  const timer = keyPopTimers.get(component);
  if (timer === undefined) return;
  clearTimeout(timer);
  keyPopTimers.delete(component);
};

Component({
  properties: {
    optionKey: { type: String, value: '' },
    text: { type: String, value: '' },
    selected: {
      type: Boolean,
      value: false,
      observer(selected: boolean, previous: boolean) {
        clearKeyPopTimer(this);
        if (selected === previous) return;
        if (!selected) {
          this.setData({ keyPopActive: false });
          return;
        }
        if (previous !== false) return;
        this.setData({ keyPopActive: true });
        const timer = setTimeout(() => {
          keyPopTimers.delete(this);
          this.setData({ keyPopActive: false });
        }, 300);
        keyPopTimers.set(this, timer);
      },
    },
    state: { type: String, value: 'idle' },
    disabled: { type: Boolean, value: false },
  },
  data: {
    keyPopActive: false,
  },
  lifetimes: {
    detached() {
      clearKeyPopTimer(this);
    },
  },
  methods: {
    handleTap() {
      if (this.data.disabled) return;
      this.triggerEvent('select', { key: this.data.optionKey });
    },
  },
});

export {};
