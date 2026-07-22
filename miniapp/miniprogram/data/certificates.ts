import type { CertificateKey, CertificateLevel, OccupationCode } from '../types/domain';

export interface Certificate {
  key: CertificateKey;
  occupation: OccupationCode;
  level: CertificateLevel;
  title: string;
  shortTitle: string;
}

export const certificateKey = (
  occupation: OccupationCode,
  level: CertificateLevel,
): CertificateKey => `${occupation}:${level}`;

const LEVELS: Array<readonly [CertificateLevel, string]> = [
  [5, '初级'],
  [4, '中级'],
  [3, '高级'],
];

const OCCUPATIONS: Array<readonly [OccupationCode, string, string]> = [
  ['4-02-06-01', '储粮保管员', '保管员'],
  ['4-08-05-01', '粮油质检员', '质检员'],
];

export const CERTIFICATES: Certificate[] = OCCUPATIONS.flatMap(([occupation, title, shortTitle]) =>
  LEVELS.map(([level, levelName]) => ({
    key: certificateKey(occupation, level),
    occupation,
    level,
    title: `${title} · ${levelName}`,
    shortTitle: `${shortTitle}${levelName}`,
  })),
);
