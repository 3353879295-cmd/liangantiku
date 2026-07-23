Component({
  properties: {
    visible: { type: Boolean, value: false },
    correct: { type: Boolean, value: false },
    expectedText: { type: String, value: '' },
    explanation: { type: String, value: '' },
    knowledgePoint: { type: String, value: '' },
    commonMistake: { type: String, value: '' },
    standardReference: { type: String, value: '' },
  },
});
