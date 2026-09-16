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
  [5, '初级'],
  [4, '中级'],
  [3, '高级'],
  [2, '技师'],
  [1, '高级技师'],
] as const satisfies ReadonlyArray<readonly [CertificateLevel, string]>;

const OCCUPATIONS = [
  ['4-02-06-01', '粮油仓储管理员', '保管员', new Set<CertificateLevel>([5, 4, 3, 2, 1])],
  ['4-08-05-01', '粮油质量检验员', '质检员', new Set<CertificateLevel>([5, 4, 3, 2, 1])],
] as const satisfies ReadonlyArray<
  readonly [OccupationCode, string, string, ReadonlySet<CertificateLevel>]
>;

const availabilityFor = (
  level: CertificateLevel,
  availableLevels: ReadonlySet<CertificateLevel>,
): CertificateAvailability => (availableLevels.has(level) ? 'available' : 'coming-soon');

export const CERTIFICATES: Certificate[] = OCCUPATIONS.flatMap(
  ([occupation, title, shortTitle, availableLevels]) =>
    LEVELS.map(([level, levelName]) => ({
      key: certificateKey(occupation, level),
      occupation,
      level,
      levelName,
      availability: availabilityFor(level, availableLevels),
      title: `${title} · ${levelName}`,
      shortTitle: `${shortTitle}${levelName}`,
    })),
);
