import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQuestion } from './factories';
import type { MembershipStatus } from '../miniprogram/types/membership';

const status: MembershipStatus = {
  isMember: true,
  startsAt: '2026-09-01T00:00:00.000Z',
  expiresAt: '2026-10-01T00:00:00.000Z',
  freeUsed: 3,
  freeRemaining: 0,
  freeLimit: 3,
  freeDate: '2026-09-23',
  serverTime: '2026-09-23T00:00:00.000Z',
  paymentAvailable: false,
};

beforeEach(() => {
  vi.resetModules();
  vi.restoreAllMocks();
  vi.stubGlobal('wx', {
    getStorageSync: vi.fn(() => ''),
    setStorageSync: vi.fn(),
    removeStorageSync: vi.fn(),
  });
});

const load = async () => {
  const { appServices } = await import('../miniprogram/services/app-services');
  const runtime = await import('../miniprogram/services/practice-runtime');
  const { MembershipError } = await import('../miniprogram/repositories/membership-client');
  const questions = [makeQuestion({ id: 'MEMBER-Q1' })];
  vi.spyOn(appServices.questions, 'list').mockResolvedValue(questions);
  vi.spyOn(appServices.questions, 'getByIds').mockResolvedValue(questions);
  const permission = vi.spyOn(appServices.membership, 'checkPermission').mockResolvedValue(status);
  return { appServices, runtime, MembershipError, permission, questions };
};

describe('full practice membership enforcement in the runtime', () => {
  it.each(['sequential', 'chapter', 'mock', 'wrong', 'favorite'] as const)(
    'rejects free users with no remaining random starts before creating %s practice',
    async (mode) => {
      const { runtime, MembershipError, permission, questions } = await load();
      permission.mockRejectedValue(new MembershipError('MEMBERSHIP_REQUIRED'));

      await expect(
        runtime.startPractice({ occupation: '4-02-06-01', level: 5, mode }),
      ).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
      await expect(runtime.startPracticeFromQuestions(questions, mode)).rejects.toMatchObject({
        code: 'MEMBERSHIP_REQUIRED',
      });
      expect(runtime.getActivePractice()).toBeNull();
    },
  );

  it('allows a member to create full practice without touching random admission', async () => {
    const { runtime, permission, questions } = await load();

    const started = await runtime.startPracticeFromQuestions(questions, 'chapter');

    expect(started?.mode).toBe('chapter');
    expect(permission).toHaveBeenCalledWith('fullPractice');
  });

  it('checks both in-memory and persisted active sessions, but leaves submitted review free', async () => {
    const { appServices, runtime, MembershipError, permission, questions } = await load();
    const active = await runtime.startPracticeFromQuestions(questions, 'sequential');
    permission.mockRejectedValue(new MembershipError('MEMBERSHIP_REQUIRED'));

    await expect(runtime.restorePractice()).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });
    expect(runtime.getActivePractice()).toMatchObject({ id: active?.id });

    appServices.progress.saveSession({
      id: 'stored-active',
      mode: 'chapter',
      questionIds: ['MEMBER-Q1'],
      answers: {},
      currentIndex: 0,
      status: 'active',
      startedAt: 1,
      updatedAt: 1,
      answerRevealMode: 'immediate',
    });
    await expect(runtime.restorePractice()).rejects.toMatchObject({ code: 'MEMBERSHIP_REQUIRED' });

    appServices.progress.saveSession({
      id: 'submitted-review',
      mode: 'chapter',
      questionIds: ['MEMBER-Q1'],
      answers: { 'MEMBER-Q1': ['A'] },
      currentIndex: 0,
      status: 'submitted',
      startedAt: 1,
      updatedAt: 2,
      submittedAt: 2,
      progressRecorded: true,
      answerRevealMode: 'immediate',
    });
    await expect(runtime.restorePractice()).resolves.toMatchObject({
      id: 'submitted-review',
      status: 'submitted',
    });
  });

  it('does not save a full-practice session when scope changes during permission verification', async () => {
    const { appServices, runtime, permission, questions } = await load();
    let scope: 'guest' | 'account' = 'guest';
    let release!: (value: MembershipStatus) => void;
    vi.spyOn(appServices.progress, 'getScope').mockImplementation(() => scope);
    permission.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const saved = vi.spyOn(appServices.progress, 'saveSession');

    const starting = runtime.startPracticeFromQuestions(questions, 'mock');
    await vi.waitFor(() => expect(permission).toHaveBeenCalledOnce());
    scope = 'account';
    release(status);

    await expect(starting).resolves.toBeNull();
    expect(saved).not.toHaveBeenCalled();
  });

  it.each([
    ['leaves and enters another account', () => ['guest', 'account'] as const, () => ['A', 'B']],
    [
      'switches accounts while account scope remains active',
      () => ['account'] as const,
      () => ['A', 'B'],
    ],
  ])('does not save an A-authorized start into B when it %s', async (_label, scopes, prefixes) => {
    const { appServices, runtime, permission, questions } = await load();
    let scope: 'guest' | 'account' = 'account';
    let prefix = prefixes()[0] ?? null;
    let release!: (value: MembershipStatus) => void;
    vi.spyOn(appServices.progress, 'getScope').mockImplementation(() => scope);
    vi.spyOn(appServices.cloudSync, 'getAvatarUploadPathPrefix').mockImplementation(() => prefix);
    appServices.progress.saveSession({
      id: 'b-submitted-review',
      mode: 'chapter',
      questionIds: ['MEMBER-Q1'],
      answers: { 'MEMBER-Q1': ['A'] },
      currentIndex: 0,
      status: 'submitted',
      startedAt: 1,
      updatedAt: 2,
      submittedAt: 2,
      progressRecorded: true,
      answerRevealMode: 'immediate',
    });
    const saved = vi.spyOn(appServices.progress, 'saveSession');
    saved.mockClear();
    permission.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );

    const starting = runtime.startPracticeFromQuestions(questions, 'chapter');
    await vi.waitFor(() => expect(permission).toHaveBeenCalledOnce());
    const [nextScope, finalScope] = scopes();
    const [firstPrefix, nextPrefix] = prefixes();
    if (nextScope === 'guest') scope = 'guest';
    prefix = nextScope === 'guest' ? (firstPrefix ?? null) : (nextPrefix ?? null);
    if (finalScope === 'account') scope = 'account';
    prefix = nextPrefix ?? null;
    release(status);

    await expect(starting).resolves.toBeNull();
    expect(appServices.progress.restoreSession()).toMatchObject({ id: 'b-submitted-review' });
    expect(saved).not.toHaveBeenCalled();
  });
});
