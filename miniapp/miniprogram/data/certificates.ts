import type {
  CertificateAvailability,
  CertificateKey,
  CertificateLevel,
  OccupationCode,
} from '../types/domain';

export interface Certificate {
  key: CertificateKey;
  occupation: OccupationCode;
  level: CertificateLevel;
  levelName: string;
  availability: CertificateAvailability;
  title: string;
  shortTitle: string;
}

export const certificateKey = (
  occupation: OccupationCode,
  level: CertificateLevel,
): CertificateKey => `${occupation}:${level}`;

const LEVELS = [
  [5, '初级', 'available'],
  [4, '中级', 'available'],
  [3, '高级', 'available'],
  [2, '技师', 'available'],
  [1, '高级技师', 'available'],
] as const satisfies ReadonlyArray<readonly [CertificateLevel, string, CertificateAvailability]>;

const OCCUPATIONS: Array<readonly [OccupationCode, string, string]> = [
  ['4-02-06-01', '粮油仓储管理员', '保管员'],
];

export const CERTIFICATES: Certificate[] = OCCUPATIONS.flatMap(([occupation, title, shortTitle]) =>
  LEVELS.map(([level, levelName, availability]) => ({
    key: certificateKey(occupation, level),
    occupation,
    level,
    levelName,
    availability,
    title: `${title} · ${levelName}`,
    shortTitle: `${shortTitle}${levelName}`,
  })),
);
