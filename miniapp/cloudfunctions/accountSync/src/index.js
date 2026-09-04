const logger = require('node:console');

let runtime;

const getRuntime = () => {
  if (runtime) return runtime;
  logger.info('[accountSync] initializing');
  const cloud = require('wx-server-sdk');
  const { createAccountKey } = require('../lib/account-key');
  const { CloudStore } = require('../lib/cloud-store');
  const { createHandler } = require('../lib/handler');
  const { isKnownAction } = require('../lib/validation');

  cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
  runtime = {
    cloud,
    handler: createHandler({
      store: new CloudStore(cloud.database({ throwOnNotFound: false })),
      hash: createAccountKey,
    }),
    isKnownAction,
  };
  logger.info('[accountSync] initialized');
  return runtime;
};

exports.main = async (event) => {
  logger.info('[accountSync] invoked');
  try {
    const initialized = getRuntime();
    const context = initialized.cloud.getWXContext();
    const requestedAction = event && typeof event.action === 'string' ? event.action : undefined;
    logger.info('[accountSync] request', {
      action: initialized.isKnownAction(requestedAction) ? requestedAction : 'invalid',
    });
    return await initialized.handler(event, context);
  } catch (error) {
    logger.error('[accountSync] unhandled', {
      name: error instanceof Error ? error.name : 'UnknownError',
      code: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
    });
    return { ok: false, error: { code: 'ACCOUNT_SYNC_UNAVAILABLE' } };
  }
};
