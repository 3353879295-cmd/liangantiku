export const CLOUD_ENVIRONMENT_ID = 'cloud1-d2gglad830c91db10';

export const initializeCloud = (): void => {
  wx.cloud.init({ env: CLOUD_ENVIRONMENT_ID, traceUser: false });
};
