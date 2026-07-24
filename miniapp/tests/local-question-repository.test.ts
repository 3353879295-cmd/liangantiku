import { describe, expect, it } from 'vitest';

import { LocalQuestionRepository } from '../miniprogram/repositories/local-question-repository';
import type { RuntimeQuestionRecord } from '../miniprogram/types/runtime-question';

const runtimeQuestion = (
  overrides: Partial<RuntimeQuestionRecord> = {},
): RuntimeQuestionRecord => ({
  id: 'WH-L5-000001',
  occupation: '4-02-06-01',
  direction: '粮油保管员',
  level: 5,
  module: '粮情检查',
  topic: '粮温检查',
  chapter_id: 'warehouse-l5-c03',
  section_id: 'warehouse-l5-c03-s03',
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
  source_ids: ['SRC-0001'],
  standard_reference: '粮情检查作业要求',
  review_status: 'verified',
  content_version: 1,
  ...overrides,
});

describe('LocalQuestionRepository', () => {
  const records = [
    runtimeQuestion(),
    runtimeQuestion({
      id: 'WH-L4-000001',
      level: 4,
      module: '通风管理',
      topic: '机械通风',
      chapter_id: 'warehouse-l4-c07',
      section_id: 'warehouse-l4-c07-s01',
    }),
    runtimeQuestion({
      id: 'QI-L5-000001',
      occupation: '4-08-05-01',
      direction: '粮油质量检验员',
      module: '水分检测',
      topic: '仪器检查',
      chapter_id: 'inspector-c04',
      section_id: 'inspector-c04-s01',
    }),
  ];

  it('filters by occupation, level and module', async () => {
    const repository = new LocalQuestionRepository(records);

    const result = await repository.list({
      occupation: '4-02-06-01',
      level: 5,
      module: '粮情检查',
    });

    expect(result.map((item) => item.id)).toEqual(['WH-L5-000001']);
    expect(result[0]).toMatchObject({ knowledgePoint: '粮温检查', reviewStatus: 'verified' });
  });

  it('returns null for a missing id', async () => {
    const repository = new LocalQuestionRepository(records);

    await expect(repository.getById('missing')).resolves.toBeNull();
  });

  it('filters by stable catalog chapter and section ids', async () => {
    const repository = new LocalQuestionRepository(records);

    await expect(repository.list({ sectionId: 'warehouse-l5-c03-s03' })).resolves.toHaveLength(1);
    await expect(repository.list({ chapterId: 'warehouse-l4-c07' })).resolves.toEqual([
      expect.objectContaining({ id: 'WH-L4-000001' }),
    ]);
    await expect(
      repository.list({
        occupation: '4-02-06-01',
        level: 5,
        chapterId: 'warehouse-l5-c03',
        sectionId: 'warehouse-l5-c03-s03',
      }),
    ).resolves.toEqual([expect.objectContaining({ id: 'WH-L5-000001' })]);
    await expect(
      repository.list({
        chapterId: 'warehouse-l4-c07',
        sectionId: 'warehouse-l5-c03-s03',
      }),
    ).resolves.toEqual([]);
  });

  it('preserves requested order and skips missing ids', async () => {
    const repository = new LocalQuestionRepository(records);

    const result = await repository.getByIds(['QI-L5-000001', 'missing', 'WH-L5-000001']);

    expect(result.map((item) => item.id)).toEqual(['QI-L5-000001', 'WH-L5-000001']);
  });
});
