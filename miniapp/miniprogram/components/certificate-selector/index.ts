import type { Certificate } from '../../data/certificates';
import type { CertificateKey, CertificateLevel, OccupationCode } from '../../types/domain';

interface RoleOption {
  occupation: OccupationCode;
  title: string;
  selected: boolean;
}

interface LevelOption {
  key: CertificateKey;
  name: string;
  statusText: string;
  selected: boolean;
}

const roleTitle = (certificate: Certificate): string =>
  certificate.title.split(' · ')[0] ?? certificate.title;

const emptyOccupation = (): OccupationCode | '' => '';

const selectedLevel = (key: string): CertificateLevel | null => {
  const value = Number(key.split(':')[1]);
  return value >= 1 && value <= 5 ? (value as CertificateLevel) : null;
};

Component({
  properties: {
    certificates: { type: Array, value: [] },
    selectedKey: { type: String, value: '' },
  },

  data: {
    activeOccupation: emptyOccupation(),
    roles: [] as RoleOption[],
    levels: [] as LevelOption[],
  },

  observers: {
    'certificates, selectedKey'(certificates: Certificate[], selectedKey: string) {
      const selected = certificates.find(({ key }) => key === selectedKey);
      const activeOccupation = selected?.occupation ?? certificates[0]?.occupation ?? '';
      this.syncOptions(certificates, selectedKey, activeOccupation);
    },
  },

  methods: {
    syncOptions(
      certificates: Certificate[],
      selectedKey: string,
      activeOccupation: OccupationCode | '',
    ) {
      const roles = certificates.reduce<RoleOption[]>((options, certificate) => {
        if (options.some(({ occupation }) => occupation === certificate.occupation)) return options;
        options.push({
          occupation: certificate.occupation,
          title: roleTitle(certificate),
          selected: certificate.occupation === activeOccupation,
        });
        return options;
      }, []);
      const levels = certificates
        .filter(({ occupation }) => occupation === activeOccupation)
        .map((certificate) => ({
          key: certificate.key,
          name: certificate.levelName,
          statusText: certificate.availability === 'available' ? '' : '待补充',
          selected: certificate.key === selectedKey,
        }));
      this.setData({ activeOccupation, roles, levels });
    },

    onRoleTap(event: WechatMiniprogram.TouchEvent) {
      const occupation = String(event.currentTarget.dataset['occupation']) as OccupationCode;
      const certificates = this.properties.certificates as Certificate[];
      if (!certificates.some((certificate) => certificate.occupation === occupation)) return;
      const level = selectedLevel(String(this.properties.selectedKey));
      const next =
        certificates.find(
          (certificate) => certificate.occupation === occupation && certificate.level === level,
        ) ?? certificates.find((certificate) => certificate.occupation === occupation);
      if (!next) return;
      this.syncOptions(certificates, next.key, occupation);
      this.triggerEvent('change', { key: next.key });
    },

    onLevelTap(event: WechatMiniprogram.TouchEvent) {
      const key = String(event.currentTarget.dataset['key']) as CertificateKey;
      const certificates = this.properties.certificates as Certificate[];
      if (!certificates.some((certificate) => certificate.key === key)) return;
      this.syncOptions(certificates, key, this.data.activeOccupation);
      this.triggerEvent('change', { key });
    },
  },
});
