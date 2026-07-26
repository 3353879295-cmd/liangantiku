import type { Certificate } from '../../data/certificates';
import {
  nextSelectorCollapsed,
  presentCertificateSelector,
} from '../../presenters/certificate-selector-presenter';
import type {
  CertificateLevelOption,
  CertificateRoleOption,
} from '../../presenters/certificate-selector-presenter';
import type { CertificateKey, OccupationCode } from '../../types/domain';

const emptyOccupation = (): OccupationCode | '' => '';

Component({
  properties: {
    certificates: { type: Array, value: [] },
    selectedKey: { type: String, value: '' },
  },

  data: {
    activeOccupation: emptyOccupation(),
    collapsed: false,
    summaryText: '',
    roles: [] as CertificateRoleOption[],
    levels: [] as CertificateLevelOption[],
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
      this.setData(
        presentCertificateSelector(
          certificates,
          selectedKey as CertificateKey | '',
          activeOccupation,
        ),
      );
    },

    onRoleTap(event: WechatMiniprogram.TouchEvent) {
      const occupation = String(event.currentTarget.dataset['occupation']) as OccupationCode;
      const certificates = this.properties.certificates as Certificate[];
      if (!certificates.some((certificate) => certificate.occupation === occupation)) return;
      const level = certificates.find(
        ({ key }) => key === String(this.properties.selectedKey),
      )?.level;
      const next =
        certificates.find(
          (certificate) => certificate.occupation === occupation && certificate.level === level,
        ) ?? certificates.find((certificate) => certificate.occupation === occupation);
      if (!next) return;
      this.setData({
        ...presentCertificateSelector(certificates, next.key, occupation),
        collapsed: nextSelectorCollapsed(this.data.collapsed, 'role'),
      });
      this.triggerEvent('change', { key: next.key });
    },

    onLevelTap(event: WechatMiniprogram.TouchEvent) {
      const key = String(event.currentTarget.dataset['key']) as CertificateKey;
      const certificates = this.properties.certificates as Certificate[];
      if (
        !certificates.some(
          (certificate) =>
            certificate.key === key && certificate.occupation === this.data.activeOccupation,
        )
      ) {
        return;
      }
      this.setData({
        ...presentCertificateSelector(certificates, key, this.data.activeOccupation),
        collapsed: nextSelectorCollapsed(this.data.collapsed, 'level'),
      });
      this.triggerEvent('change', { key });
    },

    onExpand() {
      this.setData({
        collapsed: nextSelectorCollapsed(this.data.collapsed, 'expand'),
      });
    },
  },
});
