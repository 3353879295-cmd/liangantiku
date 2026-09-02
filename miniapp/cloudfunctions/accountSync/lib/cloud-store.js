class CloudStore {
  constructor(database, serverDate = () => database.serverDate()) {
    this.database = database;
    this.serverDate = serverDate;
  }

  async transaction(work) {
    const result = await this.database.runTransaction(async (transaction) =>
      work(new CloudStore(transaction, this.serverDate)),
    );
    return result && typeof result === 'object' && Object.hasOwn(result, 'result')
      ? result.result
      : result;
  }

  async getAccount(id) {
    const result = await this.database
      .collection('user_accounts')
      .doc(id)
      .get({ throwOnNotFound: false });
    return CloudStore.withoutDocumentId(result.data);
  }

  async getProgress(id) {
    const result = await this.database
      .collection('user_progress')
      .doc(id)
      .get({ throwOnNotFound: false });
    return CloudStore.withoutDocumentId(result.data);
  }

  static withoutDocumentId(data) {
    if (!data) {
      return null;
    }
    const value = { ...data };
    delete value._id;
    return value;
  }

  async createAccount(id, value) {
    const now = this.serverDate();
    await this.database
      .collection('user_accounts')
      .doc(id)
      .set({
        data: { ...value, created_at: now, updated_at: now },
      });
  }

  async createProgress(id, value) {
    const now = this.serverDate();
    await this.database
      .collection('user_progress')
      .doc(id)
      .set({
        data: { ...value, created_at: now, updated_at: now },
      });
  }

  async saveAccount(id, value) {
    await this.database
      .collection('user_accounts')
      .doc(id)
      .update({
        data: { ...CloudStore.withoutDocumentId(value), updated_at: this.serverDate() },
      });
  }

  async saveProgress(id, value) {
    await this.database
      .collection('user_progress')
      .doc(id)
      .update({
        data: { ...CloudStore.withoutDocumentId(value), updated_at: this.serverDate() },
      });
  }

  async getRecord(id) {
    const result = await this.database
      .collection('user_practice_records')
      .doc(id)
      .get({ throwOnNotFound: false });
    return CloudStore.withoutDocumentId(result.data);
  }

  async createRecord(id, value) {
    await this.database
      .collection('user_practice_records')
      .doc(id)
      .set({ data: { ...value, submitted_at: this.serverDate() } });
  }

  async listRecordIdsForAccount(accountKey) {
    const result = await this.database
      .collection('user_practice_records')
      .where({ account_key: accountKey })
      .orderBy('submitted_at', 'asc')
      .limit(50)
      .get();
    return (result.data || []).map((record) => record._id);
  }

  async removeRecords(ids) {
    await Promise.all(
      ids.map((id) => this.database.collection('user_practice_records').doc(id).remove()),
    );
  }

  async removeProgress(id) {
    await this.database.collection('user_progress').doc(id).remove();
  }

  async removeAccount(id) {
    await this.database.collection('user_accounts').doc(id).remove();
  }
}

module.exports = { CloudStore };
