Component({
  properties: { visible: { type: Boolean, value: false } },
  methods: {
    close() {
      this.triggerEvent('close');
    },
    confirm() {
      this.triggerEvent('confirm');
    },
  },
});
