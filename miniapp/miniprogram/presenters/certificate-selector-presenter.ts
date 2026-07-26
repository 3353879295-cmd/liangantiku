import type { Certificate } from '../data/certificates';
import type { CertificateKey, OccupationCode } from '../types/domain';

export interface CertificateRoleOption {
  occupation: OccupationCode;
  title: string;
  selected: boolean;
}

export interface CertificateLevelOption {
  key: CertificateKey;
  name: string;
  statusText: string;
  selected: boolean;
}

export interface CertificateSelectorViewModel {
  activeOccupation: OccupationCode | '';
  summaryText: string;
  roles: CertificateRoleOption[];
  levels: CertificateLevelOption[];
}

export type SelectorAction = 'role' | 'level' | 'expand';

const roleTitle = (certificate: Certificate): string =>
  certificate.title.split(' · ')[0]?.trim() || certificate.title;

export const presentCertificateSelector = (
  certificates: readonly Certificate[],
  selectedKey: CertificateKey | '',
  activeOccupation: OccupationCode | '',
): CertificateSelectorViewModel => {
  const selected = certificates.find(({ key }) => key === selectedKey) ?? certificates[0];
  const occupation =
    (certificates.some(({ occupation: candidate }) => candidate === activeOccupation)
      ? activeOccupation
      : selected?.occupation) ??
    certificates[0]?.occupation ??
    '';

  const roles = certificates.reduce<CertificateRoleOption[]>((options, certificate) => {
    if (options.some(({ occupation: candidate }) => candidate === certificate.occupation)) {
      return options;
    }
    options.push({
      occupation: certificate.occupation,
      title: roleTitle(certificate),
      selected: certificate.occupation === occupation,
    });
    return options;
  }, []);

  const levels = certificates
    .filter(({ occupation: candidate }) => candidate === occupation)
    .map((certificate) => ({
      key: certificate.key,
      name: certificate.levelName,
      statusText: certificate.availability === 'available' ? '' : '待补充',
      selected: certificate.key === selectedKey,
    }));

  return {
    activeOccupation: occupation,
    summaryText: selected?.title ?? '',
    roles,
    levels,
  };
};

export const nextSelectorCollapsed = (current: boolean, action: SelectorAction): boolean => {
  if (action === 'level') return true;
  if (action === 'expand') return false;
  return current;
};
