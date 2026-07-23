import type { StorageAdapter } from '../types/domain';

export class WechatStorageAdapter implements StorageAdapter {
  get<T>(key: string): T | null {
    const value: unknown = wx.getStorageSync(key);
    if (value === '' || value === null || value === undefined) return null;
    return value as T;
  }

  set<T>(key: string, value: T): void {
    wx.setStorageSync(key, value);
  }

  remove(key: string): void {
    wx.removeStorageSync(key);
  }
}
