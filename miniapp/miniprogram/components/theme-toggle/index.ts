Component({
  properties: {
    theme: { type: String, value: 'light' },
  },
  methods: {
    handleTap() {
      this.triggerEvent('change', {
        theme: this.data.theme === 'night' ? 'light' : 'night',
      });
    },
  },
});

export {};
