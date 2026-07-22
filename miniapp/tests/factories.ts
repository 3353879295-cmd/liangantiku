import type { Question } from '../miniprogram/types/domain';

export const makeQuestion = (overrides: Partial<Question> = {}): Question => ({
  id: 'WH-L5-000001',
  occupation: '4-02-06-01',
  direction: '粮油保管员',
  level: 5,
  module: '粮情检查',
  topic: '粮温检查',
  type: 'single',
  stem: '检查粮温时首先应确认什么？',
  options: [
    { key: 'A', text: '测温设备状态' },
    { key: 'B', text: '仓外颜色' },
    { key: 'C', text: '人员数量' },
    { key: 'D', text: '运输车辆' },
  ],
  answer: ['A'],
  explanation: '测量前应确认设备状态正常。',
  difficulty: 'easy',
  keywords: ['粮温'],
  sourceIds: ['SRC-0001'],
  standardReference: '粮情检查作业要求',
  reviewStatus: 'verified',
  contentVersion: 1,
  knowledgePoint: '粮温检查',
  ...overrides,
});
