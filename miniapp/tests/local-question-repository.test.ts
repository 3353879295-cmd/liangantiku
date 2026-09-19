import { describe, expect, it, vi } from 'vitest';

import { LocalQuestionRepository } from '../miniprogram/repositories/local-question-repository';
import type {
  RuntimeQuestionBank,
  RuntimeQuestionRecord,
} from '../miniprogram/types/runtime-question';

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

  it('reads certificate counts from metadata without loading a shard', async () => {
    const load = vi.fn(() => [runtimeQuestion()]);
    const bank: RuntimeQuestionBank = {
      shards: [
        {
          occupation: '4-02-06-01',
          level: 5,
          count: 37,
          paths: [],
          load,
        },
      ],
      counts: {
        '4-02-06-01': { 1: 0, 2: 0, 3: 0, 4: 0, 5: 37 },
        '4-08-05-01': { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    };
    const repository = new LocalQuestionRepository(bank);

    await expect(repository.count({ occupation: '4-02-06-01', level: 5 })).resolves.toBe(37);
    expect(load).not.toHaveBeenCalled();

    await expect(repository.list({ occupation: '4-02-06-01', level: 5 })).resolves.toHaveLength(1);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('loads only the matching shard and retries a failed loader', async () => {
    let attempts = 0;
    const warehouseLoad = vi.fn(() => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary decode failure');
      return [runtimeQuestion()];
    });
    const inspectorLoad = vi.fn(() => [
      runtimeQuestion({ id: 'QI-L5-000001', occupation: '4-08-05-01' }),
    ]);
    const bank: RuntimeQuestionBank = {
      shards: [
        {
          occupation: '4-02-06-01',
          level: 5,
          count: 1,
          paths: [],
          load: warehouseLoad,
        },
        {
          occupation: '4-08-05-01',
          level: 5,
          count: 1,
          paths: [],
          load: inspectorLoad,
        },
      ],
      counts: {
        '4-02-06-01': { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
        '4-08-05-01': { 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 },
      },
      shardForId: (id) => (id.startsWith('QI-') ? bank.shards[1] : bank.shards[0]),
    };
    const repository = new LocalQuestionRepository(bank);

    await expect(repository.list({ occupation: '4-02-06-01', level: 5 })).rejects.toThrow(
      'temporary decode failure',
    );
    await expect(repository.getById('WH-L5-000001')).resolves.toMatchObject({ id: 'WH-L5-000001' });
    await expect(repository.getByIds(['QI-L5-000001', 'WH-L5-000001'])).resolves.toEqual([
      expect.objectContaining({ id: 'QI-L5-000001' }),
      expect.objectContaining({ id: 'WH-L5-000001' }),
    ]);
    expect(warehouseLoad).toHaveBeenCalledTimes(2);
    expect(inspectorLoad).toHaveBeenCalledTimes(1);
  });

  it('does not retain a partial shard when adapting one record fails', async () => {
    let valid = false;
    const load = vi.fn(() =>
      valid
        ? [runtimeQuestion(), runtimeQuestion({ id: 'WH-L5-000002' })]
        : [runtimeQuestion(), runtimeQuestion({ id: 'WH-L5-000002', answer: undefined as never })],
    );
    const bank: RuntimeQuestionBank = {
      shards: [
        {
          occupation: '4-02-06-01',
          level: 5,
          count: 2,
          paths: [],
          load,
        },
      ],
      counts: {
        '4-02-06-01': { 1: 0, 2: 0, 3: 0, 4: 0, 5: 2 },
        '4-08-05-01': { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
      },
    };
    const repository = new LocalQuestionRepository(bank);

    await expect(repository.list({ occupation: '4-02-06-01', level: 5 })).rejects.toThrow();
    valid = true;
    await expect(repository.list({ occupation: '4-02-06-01', level: 5 })).resolves.toHaveLength(2);
  });
});
