interface FavoriteFeedbackComponent {
  data: {
    active: boolean;
  };
  setData(
    updates: {
      popActive?: boolean;
      rippleActive?: boolean;
    },
    callback?: () => void,
  ): void;
}

const feedbackTimers = new WeakMap<object, ReturnType<typeof setTimeout>>();
const feedbackGenerations = new WeakMap<object, number>();
const detachedComponents = new WeakSet<object>();

const clearFeedbackTimer = (component: object): void => {
  const timer = feedbackTimers.get(component);
  if (timer === undefined) return;
  clearTimeout(timer);
  feedbackTimers.delete(component);
};

const restartFeedback = (component: FavoriteFeedbackComponent): void => {
  clearFeedbackTimer(component);
  if (detachedComponents.has(component)) return;
  const generation = (feedbackGenerations.get(component) ?? 0) + 1;
  feedbackGenerations.set(component, generation);

  component.setData({ popActive: false, rippleActive: false }, () => {
    if (detachedComponents.has(component) || feedbackGenerations.get(component) !== generation) {
      return;
    }
    component.setData({ popActive: true, rippleActive: true });
    const timer = setTimeout(() => {
      if (detachedComponents.has(component) || feedbackGenerations.get(component) !== generation) {
        return;
      }
      feedbackTimers.delete(component);
      component.setData({ popActive: false, rippleActive: false });
    }, 420);
    feedbackTimers.set(component, timer);
  });
};

Component({
  properties: {
    active: {
      type: Boolean,
      value: false,
      observer(active: boolean, previous: boolean | undefined) {
        if (previous === undefined || active === previous) return;
        restartFeedback(this);
      },
    },
  },
  data: {
    popActive: false,
    rippleActive: false,
  },
  lifetimes: {
    attached() {
      detachedComponents.delete(this);
    },
    detached() {
      detachedComponents.add(this);
      feedbackGenerations.set(this, (feedbackGenerations.get(this) ?? 0) + 1);
      clearFeedbackTimer(this);
    },
  },
  methods: {
    handleTap() {
      this.triggerEvent('change', { active: !this.data.active });
    },
  },
});

export {};
