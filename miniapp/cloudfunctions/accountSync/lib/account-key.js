const crypto = require('node:crypto');

const createAccountKey = (appId, openId) =>
  crypto.createHash('sha256').update(`${appId}:${openId}`).digest('hex');

module.exports = { createAccountKey };
