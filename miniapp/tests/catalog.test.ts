import { describe, expect, it } from 'vitest';

import { CERTIFICATES, certificateKey } from '../miniprogram/data/certificates';

describe('certificate catalog', () => {
  it('contains both occupations at levels five, four and three', () => {
    expect(CERTIFICATES.map((item) => item.key)).toEqual([
      '4-02-06-01:5',
      '4-02-06-01:4',
      '4-02-06-01:3',
      '4-08-05-01:5',
      '4-08-05-01:4',
      '4-08-05-01:3',
    ]);
    expect(certificateKey('4-08-05-01', 3)).toBe('4-08-05-01:3');
  });
});
