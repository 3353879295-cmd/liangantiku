Component({
  properties: {
    optionKey: { type: String, value: '' },
    text: { type: String, value: '' },
    selected: { type: Boolean, value: false },
    state: { type: String, value: 'neutral' },
    disabled: { type: Boolean, value: false },
  },
  methods: {
    handleTap() {
      if (this.data.disabled) return;
      this.triggerEvent('select', { key: this.data.optionKey });
    },
  },
});
