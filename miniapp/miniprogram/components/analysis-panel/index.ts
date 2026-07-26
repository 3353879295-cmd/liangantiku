Component({
  properties: {
    visible: { type: Boolean, value: false },
    showResult: { type: Boolean, value: true },
    correct: { type: Boolean, value: false },
    selectedText: { type: String, value: '未作答' },
    expectedText: { type: String, value: '' },
    explanation: { type: String, value: '' },
    knowledgePoint: { type: String, value: '' },
    commonMistake: { type: String, value: '' },
    standardReference: { type: String, value: '' },
    questionId: { type: String, value: '' },
  },
  data: {
    feedbackAvailable: false,
  },
  lifetimes: {
    attached() {
      this.setData({
        feedbackAvailable: wx.canIUse('button.open-type.feedback'),
      });
    },
  },
  methods: {
    handleCopyQuestionId() {
      const questionId = String(this.data.questionId);
      if (!questionId) return;
      void wx.setClipboardData({ data: questionId });
      void wx.showToast({ title: '题目 ID 已复制', icon: 'none' });
    },
  },
});

export {};
