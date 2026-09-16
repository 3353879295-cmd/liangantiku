export const MEMBERSHIP_STAGING_ENV_ID = 'membership-staging-d7c032b6e3273';

export const canUseMembershipStaging = (envVersion: string | undefined): boolean =>
  envVersion === 'develop' || envVersion === 'trial' || envVersion === 'release';
