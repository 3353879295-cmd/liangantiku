import { describe, expect, it, vi } from 'vitest';

import { WechatAvatarService } from '../miniprogram/services/wechat-avatar-service';

const prefix = `account-avatars/${'a'.repeat(64)}`;
const fileID = (path: string) => `cloud://cloud1-d2gglad830c91db10.bucket/${path}`;
class Storage {
  values = new Map<string, unknown>();
  get<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null;
  }
  set<T>(key: string, value: T): void {
    this.values.set(key, value);
  }
  remove(key: string): void {
    this.values.delete(key);
  }
}

describe('WechatAvatarService', () => {
  it('uses the server-derived controlled path and preserves the selected extension', async () => {
    const upload = vi.fn(({ cloudPath }: { cloudPath: string }) =>
      Promise.resolve({ fileID: fileID(cloudPath) }),
    );
    const service = new WechatAvatarService(upload, undefined, undefined, () => 'nonce0001');

    await expect(service.upload('wxfile://tmp/avatar.PNG?cache=1', prefix)).resolves.toBe(
      fileID(`${prefix}/nonce0001.png`),
    );
    await service.upload('wxfile://tmp/avatar.jpeg', prefix);

    expect(upload).toHaveBeenNthCalledWith(1, {
      cloudPath: `${prefix}/nonce0001.png`,
      filePath: 'wxfile://tmp/avatar.PNG?cache=1',
    });
    expect(upload).toHaveBeenNthCalledWith(2, {
      cloudPath: `${prefix}/nonce0001.jpeg`,
      filePath: 'wxfile://tmp/avatar.jpeg',
    });
  });

  it('uses a distinct object path for each upload', async () => {
    const paths: string[] = [];
    const upload = vi.fn(({ cloudPath }: { cloudPath: string }) => {
      paths.push(cloudPath);
      return Promise.resolve({ fileID: fileID(cloudPath) });
    });
    let value = 0;
    const service = new WechatAvatarService(
      upload,
      undefined,
      undefined,
      () => `nonce000${++value}`,
    );

    await service.upload('/tmp/a.jpg', prefix);
    await service.upload('/tmp/b.jpg', prefix);

    expect(paths).toEqual([`${prefix}/nonce0001.jpg`, `${prefix}/nonce0002.jpg`]);
  });

  it('rejects unsafe prefixes and file IDs from another environment', async () => {
    const upload = vi.fn(() =>
      Promise.resolve({ fileID: 'cloud://other-env/account-avatars/a.jpg' }),
    );
    const service = new WechatAvatarService(upload);

    await expect(service.upload('/tmp/avatar.heic', 'account-avatars/../../other')).rejects.toThrow(
      'path is invalid',
    );
    await expect(service.upload('/tmp/avatar.heic', prefix)).rejects.toThrow('unexpected file ID');
  });

  it('removes only controlled current-environment avatar objects and accepts missing files', async () => {
    const avatar = fileID(`${prefix}/nonce0001.webp`);
    const deleteFile = vi.fn(() =>
      Promise.resolve({ fileList: [{ fileID: avatar, status: -503003 }] }),
    );
    const service = new WechatAvatarService(vi.fn(), deleteFile);

    await expect(service.remove(avatar)).resolves.toBeUndefined();
    expect(deleteFile).toHaveBeenCalledWith([avatar]);
    await expect(service.remove('cloud://other-env/account-avatars/a.jpg')).rejects.toThrow(
      'invalid',
    );
  });

  it('rejects an empty delete result instead of treating avatar cleanup as successful', async () => {
    const service = new WechatAvatarService(vi.fn(), () => Promise.resolve({ fileList: [] }));

    await expect(service.remove(fileID(`${prefix}/nonce0001.jpg`))).rejects.toThrow(
      'removal failed',
    );
  });

  it('persists uploads, confirms bindings, and keeps failed cleanup registered for a restart', async () => {
    const storage = new Storage();
    const first = fileID(`${prefix}/nonce0001.jpg`);
    const second = fileID(`${prefix}/nonce0002.png`);
    const upload = vi
      .fn()
      .mockResolvedValueOnce({ fileID: first })
      .mockResolvedValueOnce({ fileID: second });
    const remove = vi.fn().mockRejectedValueOnce(new Error('offline'));
    const service = new WechatAvatarService(
      upload,
      remove,
      storage,
      (() => {
        let value = 0;
        return () => `nonce000${++value}`;
      })(),
    );

    await service.upload('/tmp/a.jpg', prefix);
    await service.upload('/tmp/b.png', prefix);
    expect(service.pending()).toEqual([first, second]);
    service.confirm(first);
    expect(new WechatAvatarService(vi.fn(), remove, storage).pending()).toEqual([second]);
    await expect(service.reconcile(null)).rejects.toThrow('offline');
    expect(service.pending()).toEqual([second]);
  });
});
