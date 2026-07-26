export type MainTab = 'home' | 'practical' | 'profile';

type MainTabUrl = '/pages/home/index' | '/pages/practical/index' | '/pages/profile/index';

export type BackTarget =
  | { type: 'navigateBack' }
  | {
      type: 'switchTab';
      url: MainTabUrl;
    };

const mainTabUrls: Record<MainTab, MainTabUrl> = {
  home: '/pages/home/index',
  practical: '/pages/practical/index',
  profile: '/pages/profile/index',
};

export const resolveBackTarget = (pageStackDepth: number, fallbackTab: MainTab): BackTarget => {
  if (pageStackDepth > 1) {
    return { type: 'navigateBack' };
  }

  return {
    type: 'switchTab',
    url: mainTabUrls[fallbackTab],
  };
};
