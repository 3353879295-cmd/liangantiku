import { afterEach, describe, expect, it, vi } from 'vitest';

interface TestPage {
  data: Record<string, unknown>;
  setData(update: Record<string, unknown>): void;
  getTabBar(): undefined;
  onShow(): void | Promise<void>;
  onHide(): void;
  onLoad(options: Record<string, string>): Promise<void>;
  onAction(event: WechatMiniprogram.TouchEvent): Promise<void>;
  onResume(): Promise<void>;
  loadCertificate(): Promise<void>;
  loadMembership(): Promise<void>;
}

const setup = async (name: 'home' | 'question-list') => {
  vi.resetModules();
  let page!: TestPage;
  const navigateTo = vi.fn((options: { success?: () => void }) => options.success?.());
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
    navigateTo,
    showToast: vi.fn(),
    setNavigationBarTitle: vi.fn(),
  });
  vi.stubGlobal('getApp', () => ({ globalData: {} }));
  vi.stubGlobal('Page', (definition: TestPage) => {
    page = {
      ...definition,
      data: structuredClone(definition.data),
      setData(update) {
        Object.assign(this.data, update);
      },
      getTabBar: () => undefined,
    };
  });
  if (name === 'home') await import('../miniprogram/pages/home/index');
  else await import('../miniprogram/pages/question-list/index');
  const { appServices } = await import('../miniprogram/services/app-services');
  const { MembershipError } = await import('../miniprogram/repositories/membership-client');
  if (name === 'home') {
    page.loadCertificate = vi.fn().mockResolvedValue(undefined);
    page.loadMembership = vi.fn().mockResolvedValue(undefined);
    await page.onShow();
    Object.assign(page.data, { loading: false, loadError: false, certificate: { canStart: true } });
  }
  const permission = vi.spyOn(appServices.membership, 'checkPermission');
  return { page, appServices, MembershipError, permission, navigateTo };
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe.each([3, 0])('free user with %i random practices remaining', (remaining) => {
  it.each(['chapter', 'mock', 'wrong', 'favorite'])('blocks the %s home entry', async (id) => {
    const { page, permission, MembershipError, navigateTo } = await setup('home');
    page.data['freePracticeText'] = `今日免费练习：剩余 ${remaining}/3 次`;
    permission.mockRejectedValue(new MembershipError('MEMBERSHIP_REQUIRED'));
    await page.onAction({
      currentTarget: { dataset: { id } },
    } as unknown as WechatMiniprogram.TouchEvent);
    expect(permission).toHaveBeenCalledExactlyOnceWith('fullPractice');
    expect(navigateTo).not.toHaveBeenCalled();
    expect(page.data['showMembershipPrompt']).toBe(true);
  });
});

it('blocks a saved nonrandom session from the home resume entry', async () => {
  const { page, permission, MembershipError, navigateTo } = await setup('home');
  Object.assign(page.data, { hasResume: true });
  permission.mockRejectedValue(new MembershipError('MEMBERSHIP_REQUIRED'));
  await page.onResume();
  expect(permission).toHaveBeenCalledWith('fullPractice');
  expect(navigateTo).not.toHaveBeenCalled();
  expect(page.data['showMembershipPrompt']).toBe(true);
});

it('opens a submitted result without requesting membership permission', async () => {
  const { page, permission, navigateTo } = await setup('home');
  Object.assign(page.data, { hasResult: true });
  await page.onResume();
  expect(permission).not.toHaveBeenCalled();
  expect(navigateTo).toHaveBeenCalledWith(expect.objectContaining({ url: '/pages/report/index' }));
});

it('does not navigate when permission service is unavailable', async () => {
  const { page, permission, navigateTo } = await setup('home');
  permission.mockRejectedValue(new Error('offline'));
  await page.onAction({
    currentTarget: { dataset: { id: 'chapter' } },
  } as unknown as WechatMiniprogram.TouchEvent);
  expect(navigateTo).not.toHaveBeenCalled();
  expect(page.data['showMembershipPrompt']).toBe(false);
});

it.each(['wrong', 'favorite'])(
  'blocks a direct %s list URL before reading questions',
  async (kind) => {
    const { page, appServices, permission, MembershipError } = await setup('question-list');
    permission.mockRejectedValue(new MembershipError('MEMBERSHIP_REQUIRED'));
    const questions = vi.spyOn(appServices.questions, 'getByIds');
    await page.onLoad({ kind });
    expect(permission).toHaveBeenCalledWith('fullPractice');
    expect(questions).not.toHaveBeenCalled();
    expect(page.data['memberRequired']).toBe(true);
    expect(page.data['memberPromptVisible']).toBe(true);
    expect(page.data['loadError']).toBe(false);
  },
);

it('keeps the current submitted wrong-answer list accessible without fullPractice', async () => {
  const { page, permission, appServices } = await setup('question-list');
  vi.spyOn(appServices.questions, 'getByIds').mockResolvedValue([]);
  await page.onLoad({ kind: 'session' });
  expect(permission).not.toHaveBeenCalled();
  expect(page.data['memberRequired']).toBe(false);
  expect(page.data['loadError']).toBe(false);
});
