import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AccountSyncClient } from '../miniprogram/repositories/account-sync-client';
import { CloudSyncService } from '../miniprogram/services/cloud-sync-service';
import { ProgressService } from '../miniprogram/services/progress-service';
import { ProgressRepository } from '../miniprogram/storage/progress-repository';
import { SyncOutbox } from '../miniprogram/storage/sync-outbox';
import type { QuestionListViewModel } from '../miniprogram/presenters/question-list-presenter';
import type { PracticeSession } from '../miniprogram/services/practice-session';
import type { StorageAdapter } from '../miniprogram/types/domain';
import { makeQuestion } from './factories';

// Use the real cloud handler against an in-memory store, never a live account.
const createStore = () => {
  const accounts = new Map<string, unknown>();
  const progress = new Map<string, unknown>();
  const records = new Map<string, unknown>();
  const read = (values: Map<string, unknown>) => (id: string) =>
    Promise.resolve(values.get(id) ?? null);
  const write = (values: Map<string, unknown>) => (id: string, value: unknown) => {
    values.set(id, value);
    return Promise.resolve();
  };
  return {
    getAccount: read(accounts),
    createAccount: write(accounts),
    getProgress: read(progress),
    createProgress: write(progress),
    saveProgress: write(progress),
    getRecord: read(records),
    createRecord: write(records),
  };
};
const require = createRequire(import.meta.url);
const { createHandler } = require('../cloudfunctions/accountSync/lib/handler.js') as {
  createHandler: (options: {
    store: ReturnType<typeof createStore>;
    hash: () => string;
  }) => (event: unknown, context: unknown) => Promise<unknown>;
};

interface SheetPage {
  data: { ready: boolean; items: Array<{ status: string }> };
  onLoad(): Promise<void>;
  onSubmit(): Promise<void>;
  onSelectQuestion(event: WechatMiniprogram.TouchEvent): void;
}
interface ReportPage {
  data: { ready: boolean; hasWrong: boolean };
  onLoad(): Promise<void>;
  onOpenAnswerSheet(): void;
  onReviewWrong(): void;
}
interface ListPage {
  data: { loaded: boolean; loadError: boolean; view: QuestionListViewModel };
  onLoad(options: Record<string, string>): Promise<void>;
}
interface PracticePage {
  data: { analysisVisible: boolean; selectedText: string; expectedText: string };
  renderSession(session: PracticeSession): void;
}

const setup = async () => {
  vi.resetModules();
  const values = new Map<string, unknown>();
  const storage: StorageAdapter = {
    get: <T>(key: string) => (values.get(key) as T | undefined) ?? null,
    set: <T>(key: string, value: T) => values.set(key, value),
    remove: (key: string) => values.delete(key),
  };
  const navigate = vi.fn((options: { success?: () => void; complete?: () => void }) => {
    options.success?.();
    options.complete?.();
  });
  vi.stubGlobal('wx', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.remove(key),
    navigateTo: navigate,
    redirectTo: navigate,
    setNavigationBarTitle: vi.fn(),
    showToast: vi.fn(),
    showModal: vi.fn().mockResolvedValue({ confirm: true }),
  });
  const repository = new ProgressRepository(storage);
  const progress = new ProgressService(repository, 'account');
  const outbox = new SyncOutbox(storage);
  const handler = createHandler({ store: createStore(), hash: () => 'a'.repeat(64) });
  let responseDelay: (() => Promise<void>) | undefined;
  const delayNextResponse = () => {
    let release!: () => void;
    let started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    responseDelay = () => {
      started();
      return gate;
    };
    return { waiting, release };
  };
  const client = new AccountSyncClient(async (request) => {
    const result = await handler(request.data, { APPID: 'wx-test', OPENID: 'review-test' });
    const delay = responseDelay;
    responseDelay = undefined;
    await delay?.();
    return { result };
  });
  const sync = new CloudSyncService(client, repository, outbox, { getScope: () => 'account' });
  expect(await sync.bootstrap()).toBe(true);
  progress.refreshAccountSnapshot();
  progress.setAccountMutationListener((command) => sync.enqueue(command));
  const { appServices } = await import('../miniprogram/services/app-services');
  appServices.progress = progress;
  const runtime = await import('../miniprogram/services/practice-runtime');
  const sessions = await import('../miniprogram/services/practice-session');
  const questions = [
    makeQuestion({ id: 'WH-L5-000001' }),
    makeQuestion({ id: 'WH-L5-000002', answer: ['B'] }),
    makeQuestion({ id: 'WH-L5-000003' }),
  ];
  vi.spyOn(appServices.questions, 'list').mockResolvedValue(questions);
  vi.spyOn(appServices.questions, 'getByIds').mockImplementation((ids) =>
    Promise.resolve(questions.filter((question) => ids.includes(question.id))),
  );

  let definition: { data: object } | undefined;
  vi.stubGlobal('Page', (value: { data: object }) => {
    definition = value;
  });
  const loadPage = async <T>(load: () => Promise<unknown>): Promise<T> => {
    definition = undefined;
    await load();
    const registered = definition as { data: object } | undefined;
    if (!registered) throw new Error('Page was not registered');
    return {
      ...registered,
      data: structuredClone(registered.data),
      setData(this: { data: object }, update: object) {
        Object.assign(this.data, update);
      },
    } as T;
  };
  const flush = async () => {
    await sync.process();
    expect(outbox.size).toBe(0);
    progress.refreshAccountSnapshot();
  };
  return {
    client,
    delayNextResponse,
    flush,
    loadPage,
    navigate,
    progress,
    questions,
    repository,
    runtime,
    sessions,
    sync,
  };
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('submitted practice review after cloud synchronization', () => {
  it.each(
    (['sequential', 'chapter', 'random', 'mock'] as const).flatMap((mode) =>
      ['before report', 'after report', 'during report'].map((syncTiming) => ({
        mode,
        syncTiming,
      })),
    ),
  )(
    'keeps $mode review available when synchronization completes $syncTiming',
    async ({ mode, syncTiming }) => {
      const {
        client,
        delayNextResponse,
        flush,
        loadPage,
        navigate,
        progress,
        questions,
        repository,
        runtime,
        sessions,
        sync,
      } = await setup();
      let session = sessions.createPracticeSession(questions, {
        mode,
        answerRevealMode: 'deferred',
        now: Date.now(),
      });
      session = sessions.answerQuestion(session, questions[0]!.id, ['A'], Date.now());
      session = sessions.answerQuestion(session, questions[1]!.id, ['A'], Date.now());
      runtime.saveActivePractice(session);
      await flush();

      const sheet = await loadPage<SheetPage>(
        () => import('../miniprogram/pages/answer-sheet/index'),
      );
      await sheet.onLoad();
      await sheet.onSubmit();
      if (syncTiming === 'before report') await flush();
      const delayed = syncTiming === 'during report' ? delayNextResponse() : undefined;
      const upload = delayed ? sync.process() : undefined;
      if (delayed) await delayed.waiting;
      const report = await loadPage<ReportPage>(() => import('../miniprogram/pages/report/index'));
      await report.onLoad();
      expect(report.data).toMatchObject({ ready: true, hasWrong: true });
      delayed?.release();
      await upload;
      await flush();
      const server = await client.call({ action: 'bootstrap', schemaVersion: 1 });
      expect(server.progress.session).toBeNull();
      const summary = progress.getDashboard('2026-09-21');

      report.onOpenAnswerSheet();
      expect(navigate).toHaveBeenLastCalledWith(
        expect.objectContaining({ url: '/pages/answer-sheet/index' }),
      );
      await sheet.onLoad();
      expect(sheet.data.ready).toBe(true);
      expect(sheet.data.items.map((item) => item.status)).toEqual([
        'correct',
        'wrong',
        'unanswered',
      ]);

      report.onReviewWrong();
      expect(navigate).toHaveBeenLastCalledWith(
        expect.objectContaining({ url: '/pages/question-list/index?kind=session' }),
      );
      const list = await loadPage<ListPage>(
        () => import('../miniprogram/pages/question-list/index'),
      );
      await list.onLoad({ kind: 'session' });
      expect(list.data).toMatchObject({ loaded: true, loadError: false });
      expect(list.data.view.items.map((item) => item.id)).toEqual(
        mode === 'sequential' ? [questions[1]!.id] : [questions[1]!.id, questions[2]!.id],
      );
      expect(list.data.view.items[0]).toMatchObject({ selectedText: 'A', answerText: 'B' });

      sheet.onSelectQuestion({
        currentTarget: { dataset: { index: 1 } },
      } as unknown as WechatMiniprogram.TouchEvent);
      await flush();
      const review = await loadPage<PracticePage>(
        () => import('../miniprogram/pages/practice/index'),
      );
      review.renderSession(runtime.getActivePractice()!);
      expect(review.data).toMatchObject({
        analysisVisible: true,
        selectedText: 'A',
        expectedText: 'B',
      });

      await sync.bootstrap();
      progress.refreshAccountSnapshot();
      await report.onLoad();
      expect(progress.getDashboard('2026-09-21')).toEqual(summary);
      expect(new ProgressService(repository, 'account').restoreSession()).toMatchObject({
        id: session.id,
        status: 'submitted',
        currentIndex: 1,
      });
      await flush();
      expect(progress.getDashboard('2026-09-21')).toEqual(summary);
    },
  );
});
