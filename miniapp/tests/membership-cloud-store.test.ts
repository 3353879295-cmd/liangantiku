import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type Row = Record<string, unknown>;
const require = createRequire(import.meta.url);
const { CloudStore } = require('../cloudfunctions/membership/lib/cloud-store.js') as {
  CloudStore: new (database: Row) => {
    listDuePendingOrders: (account: string, limit: number) => Promise<Row[]>;
    listDueReconcileOrders: (account: string | null, limit: number, due?: string) => Promise<Row[]>;
  };
};

const account = 'account';
const reliableClosed = (id: string, next: string): Row => ({
  _id: id,
  order_id: id,
  account_key: account,
  app_id: 'wx-test',
  open_id: 'open-test',
  status: 'CLOSED',
  next_check_at: next,
  platform_evidence_version: 1,
  platform_trade_state: 'CLOSED',
  platform_verified_at: '2026-09-06T00:00:00.000Z',
  platform_env: 1,
  platform_status: 7,
  platform_order_type: 0,
  platform_app_id: 'wx-test',
  platform_open_id: 'open-test',
});

const database = (rows: Row[]) => {
  return {
    command: {
      in: (values: string[]) => ({ in: values }),
      lte: (value: string) => ({ lte: value }),
      gt: (value: string) => ({ gt: value }),
    },
    collection: () => {
      const collection = {
        doc: () => ({ get: () => ({ data: null }) }),
        where(where: Row) {
          let offset = 0;
          let count = Infinity;
          const orderFields: string[] = [];
          const query = {
            orderBy(field: string) {
              orderFields.push(field);
              return query;
            },
            skip(value: number) {
              offset = value;
              return query;
            },
            limit(value: number) {
              count = value;
              return query;
            },
            get() {
              const due = where.next_check_at as { lte?: string } | undefined;
              const statuses = where.status as { in: string[] };
              const after = where._id as { gt?: string } | undefined;
              const filtered = rows
                .filter(
                  (row) =>
                    statuses.in.includes(String(row.status)) &&
                    (!where.account_key || row.account_key === where.account_key) &&
                    (!due?.lte || String(row.next_check_at) <= due.lte) &&
                    (!after?.gt || String(row._id) > after.gt),
                )
                .sort((left, right) => {
                  for (const field of orderFields) {
                    const compared = String(left[field]).localeCompare(String(right[field]));
                    if (compared) return compared;
                  }
                  return 0;
                });
              return { data: filtered.slice(offset, offset + count) };
            },
          };
          return query;
        },
      };
      return collection;
    },
    runTransaction: () => undefined,
  };
};

describe('membership cloud order selection', () => {
  it('pages past more than one hundred reliable terminal orders to find an unresolved legacy order', async () => {
    const rows = Array.from({ length: 101 }, (_, index) =>
      reliableClosed(
        `closed-${index}`,
        `2026-09-06T00:${String(index % 60).padStart(2, '0')}:00.000Z`,
      ),
    );
    rows.push({
      ...reliableClosed('legacy-closed', '2026-09-07T00:00:00.000Z'),
      platform_evidence_version: 0,
    });
    const store = new CloudStore(database(rows));

    await expect(store.listDuePendingOrders(account, 1)).resolves.toMatchObject([
      { order_id: 'legacy-closed', status: 'CLOSED' },
    ]);
  });

  it('does not return a recoverable purchase when all terminal evidence is reliable', async () => {
    const store = new CloudStore(database([reliableClosed('closed', '2026-09-06T00:00:00.000Z')]));
    await expect(store.listDuePendingOrders(account, 1)).resolves.toEqual([]);
  });

  it('omits cancelled purchases from client recovery while retaining them for reconciliation', async () => {
    const cancelled = {
      _id: 'cancelled',
      order_id: 'cancelled',
      account_key: account,
      status: 'PENDING',
      next_check_at: '2026-09-06T00:00:00.000Z',
      purchase_cancelled_at: '2026-09-06T00:00:00.000Z',
    };
    const store = new CloudStore(database([cancelled]));

    await expect(store.listDuePendingOrders(account, 1)).resolves.toEqual([]);
    await expect(store.listDueReconcileOrders(account, 1)).resolves.toMatchObject([
      { order_id: 'cancelled', status: 'PENDING' },
    ]);
  });

  it('uses an _id cursor to reach a later unresolved order with equal check times', async () => {
    const next = '2026-09-06T00:00:00.000Z';
    const rows = Array.from({ length: 40 }, (_, index) =>
      reliableClosed(`closed-${String(index).padStart(2, '0')}`, next),
    );
    rows.push({ ...reliableClosed('legacy-zz', next), platform_evidence_version: 0 });
    const store = new CloudStore(database(rows));

    await expect(store.listDuePendingOrders(account, 1)).resolves.toMatchObject([
      { order_id: 'legacy-zz', status: 'CLOSED' },
    ]);
  });

  it('keeps an unverified terminal as a blocker but does not let PREPARED occupy a timer slot', async () => {
    const rows = [
      { ...reliableClosed('legacy', '2026-09-06T00:00:00.000Z'), platform_evidence_version: 0 },
      {
        _id: 'prepared',
        order_id: 'prepared',
        account_key: account,
        status: 'PREPARED',
        next_check_at: '2026-09-05T00:00:00.000Z',
      },
      {
        _id: 'pending',
        order_id: 'pending',
        account_key: account,
        status: 'PENDING',
        next_check_at: '2026-09-05T00:01:00.000Z',
      },
    ];
    const recoveryStore = new CloudStore(
      database(rows.filter((row) => !['prepared', 'pending'].includes(String(row.order_id)))),
    );
    await expect(recoveryStore.listDuePendingOrders(account, 1)).resolves.toMatchObject([
      { order_id: 'legacy', status: 'CLOSED' },
    ]);
    const store = new CloudStore(database(rows));
    await expect(
      store.listDueReconcileOrders(account, 1, '2026-09-06T00:00:00.000Z'),
    ).resolves.toMatchObject([{ order_id: 'legacy', status: 'CLOSED' }]);
  });
});
