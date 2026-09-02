import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const entrySource = readFileSync(
  new URL('../cloudfunctions/accountSync/index.js', import.meta.url),
  'utf8',
);

describe('accountSync cloud function entry', () => {
  it('configures missing document reads on the CloudBase database adapter', () => {
    expect(entrySource).toContain(
      'store: new CloudStore(cloud.database({ throwOnNotFound: false }))',
    );
  });
});
