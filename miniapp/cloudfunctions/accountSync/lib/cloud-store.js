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
    const result = await this.database.collection('user_accounts').doc(id).get();
    return result.data || null;
  }

  async getProgress(id) {
    const result = await this.database.collection('user_progress').doc(id).get();
    return result.data || null;
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
        data: { ...value, updated_at: this.serverDate() },
      });
  }

  async saveProgress(id, value) {
    await this.database
      .collection('user_progress')
      .doc(id)
      .update({
        data: { ...value, updated_at: this.serverDate() },
      });
  }
}

module.exports = { CloudStore };
