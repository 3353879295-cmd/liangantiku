const cloud = require('wx-server-sdk');
const { env } = require('node:process');
const { info } = require('node:console');
const { CloudStore } = require('./lib/cloud-store');
const { createHandler } = require('./lib/handler');
const { createDiagnostics } = require('./lib/diagnostics');
const { createEntry } = require('./lib/entry');
const { VirtualPayment, virtualConfigFromEnv } = require('./lib/virtual-payment');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const store = new CloudStore(cloud.database({ throwOnNotFound: false }));
const payment = new VirtualPayment(virtualConfigFromEnv());
const diagnostics = createDiagnostics({ logger: { info } });
exports.main = createEntry({
  store,
  payment,
  handler: createHandler({ store, payment, diagnostics }),
  getContext: () => cloud.getWXContext(),
  isTimerInvocation: () => env.TRIGGER_SRC === 'timer',
  diagnostics,
});
