'use strict';
const { hasReliableTerminalEvidence, hasReleasedTestHold } = require('./order-state');
class CloudStore {
  constructor(database) {
    this.database = database;
  }
  async transaction(work) {
    const result = await this.database.runTransaction(async (transaction) =>
      work(new CloudStore(transaction)),
    );
    return result && result.result !== undefined ? result.result : result;
  }
  async get(collection, id) {
    const value = await this.database.collection(collection).doc(id).get();
    return value.data ? withoutId(value.data) : null;
  }
  async save(collection, id, value) {
    await this.database.collection(collection).doc(id).set({ data: value });
  }
  getEntitlement(id) {
    return this.get('member_entitlements', id);
  }
  saveEntitlement(id, value) {
    return this.save('member_entitlements', id, value);
  }
  getUsage(id) {
    return this.get('member_usage', id);
  }
  saveUsage(id, value) {
    return this.save('member_usage', id, value);
  }
  getGrant(account, session) {
    return this.get('member_practice_grants', `${account}:${session}`);
  }
  createGrant(id, value) {
    return this.save('member_practice_grants', id, value);
  }
  getOrder(id) {
    return this.get('member_orders', id);
  }
  createOrder(id, value) {
    return this.save('member_orders', id, value);
  }
  saveOrder(id, value) {
    return this.save('member_orders', id, value);
  }
  getPendingPurchase(accountKey) {
    return this.get('member_orders', `pending_${accountKey}`);
  }
  savePendingPurchase(accountKey, orderId) {
    return this.save('member_orders', `pending_${accountKey}`, {
      pending_order_id: orderId,
    });
  }
  async getOrderByTransaction(transaction) {
    const lock = await this.get('member_payment_transactions', transaction);
    return lock;
  }
  saveTransactionLock(transaction, orderId) {
    return this.save('member_payment_transactions', transaction, { order_id: orderId });
  }
  async listDuePendingOrders(account, limit, dueBefore) {
    return this.listOrdersByStatuses(
      ['PREPARED', 'PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING', 'CLOSED', 'FAILED'],
      account,
      limit,
      dueBefore,
      true,
      true,
    );
  }
  async listDueReconcileOrders(account, limit, dueBefore) {
    const groups = await Promise.all([
      this.listOrdersByStatuses(
        ['PAYMENT_STARTING', 'PAYMENT_UNKNOWN', 'PENDING', 'CLOSED', 'FAILED'],
        account,
        limit,
        dueBefore,
      ),
      this.listOrders(['PAID'], account, limit, dueBefore),
    ]);
    return groups
      .flat()
      .sort((left, right) => String(left.next_check_at).localeCompare(String(right.next_check_at)))
      .slice(0, limit);
  }
  async listOrdersByStatuses(
    statuses,
    account,
    limit,
    dueBefore,
    filterReliableTerminals = true,
    filterReleasedTestHolds = false,
  ) {
    return this.listOrders(
      statuses,
      account,
      limit,
      dueBefore,
      filterReliableTerminals,
      filterReleasedTestHolds,
    );
  }
  async listOrders(
    statuses,
    account,
    limit,
    dueBefore,
    filterReliableTerminals = false,
    filterReleasedTestHolds = false,
  ) {
    const eligible = [];
    const pageSize = Math.max(20, Math.min(100, limit));
    let lastId = null;
    while (eligible.length < limit) {
      const r = await this.database
        .collection('member_orders')
        .where({
          status: this.database.command.in(statuses),
          ...(account ? { account_key: account } : {}),
          ...(dueBefore ? { next_check_at: this.database.command.lte(dueBefore) } : {}),
          ...(lastId ? { _id: this.database.command.gt(lastId) } : {}),
        })
        .orderBy('_id', 'asc')
        .limit(pageSize)
        .get();
      const rawRows = r.data || [];
      if (!rawRows.length) break;
      const rows = rawRows.map(withoutId);
      eligible.push(
        ...rows.filter(
          (order) =>
            (!filterReliableTerminals ||
              !['CLOSED', 'FAILED', 'REFUNDED'].includes(order.status) ||
              !hasReliableTerminalEvidence(order)) &&
            (!filterReleasedTestHolds || !hasReleasedTestHold(order)),
        ),
      );
      if (rawRows.length < pageSize) break;
      lastId = rawRows[rawRows.length - 1]._id;
      if (typeof lastId !== 'string' || !lastId) break;
    }
    return eligible.slice(0, limit);
  }
}
const withoutId = (value) => {
  const copy = { ...value };
  delete copy._id;
  return copy;
};
module.exports = { CloudStore };
