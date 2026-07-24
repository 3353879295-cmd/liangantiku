import type { Certificate } from '../data/certificates';
import type { OccupationCode, Question } from '../types/domain';

export { presentCatalogParts } from './catalog-presenter';
export type {
  CatalogChapterViewModel,
  CatalogPartViewModel,
  CatalogSectionViewModel,
} from './catalog-presenter';

export interface CertificateGroup {
  occupation: OccupationCode;
  title: string;
  items: Certificate[];
}

export interface LibraryModuleViewModel {
  name: string;
  count: number;
  countText: string;
}

const OCCUPATION_TITLES: Record<OccupationCode, string> = {
  '4-02-06-01': '储粮保管员',
  '4-08-05-01': '粮油质检员',
};

export const groupCertificates = (certificates: readonly Certificate[]): CertificateGroup[] => {
  const groups = new Map<OccupationCode, Certificate[]>();
  for (const certificate of certificates) {
    const items = groups.get(certificate.occupation) ?? [];
    groups.set(certificate.occupation, [...items, certificate]);
  }
  return [...groups].map(([occupation, items]) => ({
    occupation,
    title: OCCUPATION_TITLES[occupation],
    items,
  }));
};

export const presentLibraryModules = (questions: readonly Question[]): LibraryModuleViewModel[] => {
  const counts = new Map<string, number>();
  for (const question of questions) {
    counts.set(question.module, (counts.get(question.module) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count, countText: `${count} 题` }));
};
