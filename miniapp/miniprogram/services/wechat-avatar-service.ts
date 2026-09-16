import { CLOUD_ENVIRONMENT_ID as ENV } from '../config/cloud';
import type { StorageAdapter } from '../types/domain';

export const PENDING_AVATAR_FILES_KEY = 'grain-practice:pending-avatar-files';
type Uploader = (value: { cloudPath: string; filePath: string }) => Promise<{ fileID: string }>;
type Deleter = (
  ids: readonly string[],
) => Promise<{ fileList: readonly { fileID: string; status: number }[] }>;
const pre = /^account-avatars\/[a-f0-9]{64}$/;
const path = /^account-avatars\/[a-f0-9]{64}\/[a-z0-9-]{8,128}\.(?:jpg|jpeg|png|webp)$/;
const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const from = (id: string) =>
  new RegExp(`^cloud://${esc(ENV)}(?:\\.[a-z0-9-]+)?/(.+)$`).exec(id)?.[1] ?? null;
const ext = (value: string): 'jpg' | 'jpeg' | 'png' | 'webp' => {
  const found = /\.(jpg|jpeg|png|webp)(?:[?#].*)?$/i.exec(value)?.[1]?.toLowerCase();
  return found === 'png' || found === 'webp' || found === 'jpeg' || found === 'jpg' ? found : 'jpg';
};
const nonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;

export class WechatAvatarService {
  constructor(
    private readonly uploadFile: Uploader = (value) => wx.cloud.uploadFile(value),
    private readonly deleteFile: Deleter = (ids) => wx.cloud.deleteFile({ fileList: [...ids] }),
    private readonly storage?: StorageAdapter,
    private readonly createNonce: () => string = nonce,
  ) {}
  isControlled(id: string): boolean {
    const value = from(id);
    return value !== null && path.test(value);
  }
  private list(): string[] {
    const value = this.storage?.get<unknown>(PENDING_AVATAR_FILES_KEY);
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === 'string' && this.isControlled(id))
      : [];
  }
  private save(ids: readonly string[]): void {
    if (!this.storage) return;
    if (ids.length) this.storage.set(PENDING_AVATAR_FILES_KEY, [...new Set(ids)]);
    else this.storage.remove(PENDING_AVATAR_FILES_KEY);
  }
  pending(): readonly string[] {
    return this.list();
  }
  confirm(id: string): void {
    this.save(this.list().filter((item) => item !== id));
  }
  async upload(filePath: string, prefix: string): Promise<string> {
    const id = this.createNonce();
    if (!filePath || !pre.test(prefix) || !/^[a-z0-9-]{8,128}$/.test(id))
      throw new Error('avatar upload path is invalid');
    const cloudPath = `${prefix}/${id}.${ext(filePath)}`;
    const result = await this.uploadFile({ cloudPath, filePath });
    if (
      typeof result?.fileID !== 'string' ||
      !new RegExp(`^cloud://${esc(ENV)}(?:\\.[a-z0-9-]+)?/${esc(cloudPath)}$`).test(result.fileID)
    )
      throw new Error('avatar upload returned an unexpected file ID');
    this.save([...this.list(), result.fileID]);
    return result.fileID;
  }
  async remove(id: string): Promise<void> {
    if (!this.isControlled(id)) throw new Error('avatar file ID is invalid');
    const result = await this.deleteFile([id]);
    if (
      result.fileList.length !== 1 ||
      result.fileList[0]?.fileID !== id ||
      ![0, -503003].includes(result.fileList[0]?.status)
    )
      throw new Error('avatar removal failed');
    this.confirm(id);
  }
  async reconcile(bound: string | null, retained: readonly string[] = []): Promise<void> {
    for (const id of this.list()) {
      if (id === bound) this.confirm(id);
      else if (!retained.includes(id)) await this.remove(id);
    }
  }
}
