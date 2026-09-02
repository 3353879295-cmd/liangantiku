class AccountSyncError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

const toErrorResponse = (error) => ({
  ok: false,
  error: {
    code: error instanceof AccountSyncError ? error.code : 'ACCOUNT_SYNC_UNAVAILABLE',
  },
});

module.exports = { AccountSyncError, toErrorResponse };
