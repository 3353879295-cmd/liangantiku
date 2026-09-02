const cloud = require('wx-server-sdk');
const { createAccountKey } = require('./lib/account-key');
const { CloudStore } = require('./lib/cloud-store');
const { createHandler } = require('./lib/handler');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const handler = createHandler({
  store: new CloudStore(cloud.database({ throwOnNotFound: false })),
  hash: createAccountKey,
});

exports.main = (event) => handler(event, cloud.getWXContext());
