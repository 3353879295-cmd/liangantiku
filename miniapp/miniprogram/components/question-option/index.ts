Component({
  properties: {
    optionKey: { type: String, value: '' },
    text: { type: String, value: '' },
    selected: { type: Boolean, value: false },
    state: { type: String, value: 'idle' },
    disabled: { type: Boolean, value: false },
  },
  data: {
    keyPopActive: false,
  },
  observers: {
    selected(selected: boolean, previous: boolean) {
      this.setData({
        keyPopActive: selected && previous === false,
      });
    },
  },
  methods: {
    handleTap() {
      if (this.data.disabled) return;
      this.triggerEvent('select', { key: this.data.optionKey });
    },
  },
});
