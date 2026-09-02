import { readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const miniappRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(miniappRoot, '..');
const miniprogramRoot = join(miniappRoot, 'miniprogram');
const cloudFunctionRoot = join(miniappRoot, 'cloudfunctions', 'accountSync');
const operationsPath = join(repositoryRoot, 'docs', 'wechat-account-cloud-sync-operations.md');

const TEXT_EXTENSIONS = new Set(['.js', '.json', '.ts', '.wxml', '.wxss']);

const readTextTree = (root: string): string => {
  const files: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'miniprogram_npm') continue;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (TEXT_EXTENSIONS.has(extname(entry.name))) files.push(absolutePath);
    }
  };
  visit(root);
  return files
    .sort()
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
};

describe('account sync security boundary', () => {
  it('keeps secrets, trusted identity and private collection access out of the client package', () => {
    const clientSource = readTextTree(miniprogramRoot);

    expect(clientSource).not.toMatch(/app[_-]?secret|secret[_-]?id|secret[_-]?key/i);
    expect(clientSource).not.toMatch(/\bopenid\b|\baccount_key\b/i);
    expect(clientSource).not.toMatch(/user_accounts|user_progress|user_practice_records/);
    expect(clientSource).not.toMatch(/\.collection\s*\(/);
  });

  it('limits the cloud storage adapter to the three declared private collections', () => {
    const cloudSource = readTextTree(cloudFunctionRoot);
    const collections = [...cloudSource.matchAll(/\.collection\(['"]([^'"]+)['"]\)/g)].map(
      (match) => match[1],
    );

    expect(new Set(collections)).toEqual(
      new Set(['user_accounts', 'user_progress', 'user_practice_records']),
    );
  });

  it('documents the exact gated cloud changes without credentials or billing changes', () => {
    const operations = readFileSync(operationsPath, 'utf8');

    expect(operations).toContain('cloud1-d2gglad830c91db10');
    expect(operations).toContain('user_accounts');
    expect(operations).toContain('user_progress');
    expect(operations).toContain('user_practice_records');
    expect(operations).toContain('account_key ASC, submitted_at ASC');
    expect(operations).toContain('普通复合索引');
    expect(operations).not.toContain('新建唯一复合索引');
    expect(operations).toContain('无权限');
    expect(operations).toContain('accountSync');
    expect(operations).toContain('Node.js 20');
    expect(operations).toContain('wx-server-sdk 3.0.1');
    expect(operations).toContain('不会修改任何计费设置');
    expect(operations).toContain('不需要 AppSecret、SecretId 或 SecretKey');
    expect(operations).toContain('未取得明确确认前，不执行任何云端操作');
  });
});
