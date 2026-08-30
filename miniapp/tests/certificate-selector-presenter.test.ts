import { describe, expect, it } from 'vitest';

import { CERTIFICATES } from '../miniprogram/data/certificates';
import {
  nextSelectorCollapsed,
  presentCertificateSelector,
} from '../miniprogram/presenters/certificate-selector-presenter';

describe('certificate selector presenter', () => {
  it('derives the selected warehouse summary and both occupation choices', () => {
    const view = presentCertificateSelector(CERTIFICATES, '4-02-06-01:4', '4-02-06-01');

    expect(view.summaryText).toBe('粮油仓储管理员 · 中级');
    expect(view.roles).toEqual([
      {
        occupation: '4-02-06-01',
        title: '粮油仓储管理员',
        selected: true,
      },
      {
        occupation: '4-08-05-01',
        title: '粮油质量检验员',
        selected: false,
      },
    ]);
    expect(
      view.levels.map(({ key, name, statusText, selected }) => ({
        key,
        name,
        statusText,
        selected,
      })),
    ).toEqual([
      { key: '4-02-06-01:5', name: '初级', statusText: '', selected: false },
      { key: '4-02-06-01:4', name: '中级', statusText: '', selected: true },
      { key: '4-02-06-01:3', name: '高级', statusText: '', selected: false },
      { key: '4-02-06-01:2', name: '技师', statusText: '', selected: false },
      { key: '4-02-06-01:1', name: '高级技师', statusText: '', selected: false },
    ]);
  });

  it('selects the quality inspector catalog and marks unreleased levels as pending', () => {
    const view = presentCertificateSelector(CERTIFICATES, '4-08-05-01:3', '4-08-05-01');

    expect(view.summaryText).toBe('粮油质量检验员 · 高级');
    expect(view.roles).toEqual([
      { occupation: '4-02-06-01', title: '粮油仓储管理员', selected: false },
      { occupation: '4-08-05-01', title: '粮油质量检验员', selected: true },
    ]);
    expect(
      view.levels.map(({ key, name, statusText, selected }) => ({
        key,
        name,
        statusText,
        selected,
      })),
    ).toEqual([
      { key: '4-08-05-01:5', name: '初级', statusText: '', selected: false },
      { key: '4-08-05-01:4', name: '中级', statusText: '', selected: false },
      { key: '4-08-05-01:3', name: '高级', statusText: '', selected: true },
      { key: '4-08-05-01:2', name: '技师', statusText: '待补充', selected: false },
      { key: '4-08-05-01:1', name: '高级技师', statusText: '待补充', selected: false },
    ]);
  });

  it('keeps role changes expanded, collapses a level choice, and reopens on demand', () => {
    expect(nextSelectorCollapsed(false, 'role')).toBe(false);
    expect(nextSelectorCollapsed(false, 'level')).toBe(true);
    expect(nextSelectorCollapsed(true, 'expand')).toBe(false);
  });
});
