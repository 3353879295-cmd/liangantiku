import { describe, expect, it } from 'vitest';

import KNOWLEDGE_CATALOG from '../../data/knowledge_catalog.json';
import { CERTIFICATES, certificateKey } from '../miniprogram/data/certificates';

describe('certificate catalog', () => {
  it('contains all five active warehouse certificate levels', () => {
    expect(CERTIFICATES.map((item) => item.key)).toEqual([
      '4-02-06-01:5',
      '4-02-06-01:4',
      '4-02-06-01:3',
      '4-02-06-01:2',
      '4-02-06-01:1',
    ]);
    expect(certificateKey('4-02-06-01', 1)).toBe('4-02-06-01:1');
  });

  it('keeps the initial warehouse catalog complete and isolated by level', () => {
    const warehouseParts = KNOWLEDGE_CATALOG.occupations['4-02-06-01'].parts;
    const partsFor = (level: 5 | 4 | 3 | 2 | 1) =>
      warehouseParts.filter((part) => part.levels.includes(level));
    const chapterTitlesFor = (level: 5 | 4 | 3 | 2 | 1) =>
      partsFor(level).flatMap((part) => part.chapters.map((chapter) => chapter.title));
    const chapterIdsFor = (level: 5 | 4 | 3 | 2 | 1) =>
      partsFor(level).flatMap((part) => part.chapters.map((chapter) => chapter.id));

    expect(chapterTitlesFor(5)).toEqual(
      expect.arrayContaining(['职业道德', '基础知识', '粮油出入库作业', '粮情检查', '粮情控制']),
    );
    expect(partsFor(5).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l5']);
    expect(partsFor(4).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l4']);
    expect(partsFor(3).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l3']);
    expect(partsFor(2).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l2']);
    expect(partsFor(1).map((part) => part.id)).toEqual(['warehouse-basic', 'warehouse-l1']);
    expect(chapterTitlesFor(2)).toEqual(
      expect.arrayContaining(['职业道德', '基础知识', '粮油出入库管理', '粮情检查', '粮情控制', '培训指导']),
    );
    expect(chapterTitlesFor(1)).toEqual(
      expect.arrayContaining(['职业道德', '基础知识', '粮油出入库管理', '粮情检查', '粮情控制', '粮油储藏工艺设计', '培训指导']),
    );
    expect(chapterIdsFor(4).every((id) => !id.startsWith('warehouse-l5-'))).toBe(true);
    expect(chapterIdsFor(3).every((id) => !id.startsWith('warehouse-l5-'))).toBe(true);
  });
});
