import { CERTIFICATES } from '../../../../data/certificates';
import { KNOWLEDGE_CATALOG } from '../../../../data/knowledge-catalog';
import {
  buildChapterPracticeRoute,
  parseChapterRoute as parseCatalogChapterRoute,
  presentCatalogParts,
} from '../../../../presenters/catalog-presenter';
import type { CatalogChapterViewModel } from '../../../../presenters/catalog-presenter';
import { appServices } from '../../../../services/app-services';
import type { CertificateLevel, OccupationCode } from '../../../../types/domain';

export const parseChapterRoute = (options: Record<string, string | undefined>) =>
  parseCatalogChapterRoute(KNOWLEDGE_CATALOG, options);

interface ChapterDetailPageData {
  loading: boolean;
  errorTitle: string;
  errorDescription: string;
  certificateTitle: string;
  occupation: OccupationCode | '';
  level: CertificateLevel | 0;
  chapter: CatalogChapterViewModel | null;
}

const initialData: ChapterDetailPageData = {
  loading: true,
  errorTitle: '',
  errorDescription: '',
  certificateTitle: '',
  occupation: '',
  level: 0,
  chapter: null,
};

Page({
  data: initialData,

  async onLoad(options: Record<string, string | undefined>) {
    const route = parseChapterRoute(options);
    if (!route) {
      this.setData({
        loading: false,
        errorTitle: '章节参数不正确',
        errorDescription: '该章节不属于当前职业与等级，请返回教材目录重新选择。',
      });
      return;
    }

    const certificate = CERTIFICATES.find(
      (item) => item.occupation === route.occupation && item.level === route.level,
    );
    if (!certificate || certificate.availability !== 'available') {
      this.setData({
        loading: false,
        errorTitle: '当前等级尚未开放',
        errorDescription: '该职业与等级的教材目录和题库正在整理，暂不能开始练习。',
      });
      return;
    }

    this.setData({
      certificateTitle: certificate.title,
      occupation: route.occupation,
      level: route.level,
    });

    try {
      const questions = await appServices.questions.list({
        occupation: route.occupation,
        level: route.level,
      });
      const chapter =
        presentCatalogParts({
          catalog: KNOWLEDGE_CATALOG,
          occupation: route.occupation,
          level: route.level,
          questions,
          getProgress: (ids) => appServices.progress.getQuestionProgress(ids),
        })
          .flatMap((part) => part.chapters)
          .find(({ id }) => id === route.chapterId) ?? null;

      if (!chapter) {
        this.setData({
          loading: false,
          errorTitle: '未找到该章节',
          errorDescription: '教材目录可能已更新，请返回后重新进入。',
        });
        return;
      }
      this.setData({ chapter, loading: false });
    } catch {
      this.setData({
        loading: false,
        errorTitle: '章节加载失败',
        errorDescription: '本地题库可能尚未同步，请返回后重试。',
      });
    }
  },

  onSectionPractice(event: WechatMiniprogram.TouchEvent) {
    const chapter = this.data.chapter;
    const occupation = this.data.occupation;
    const level = this.data.level;
    const sectionId = String(event.currentTarget.dataset['sectionId'] ?? '');
    if (!chapter || !occupation || !level || !sectionId) return;
    const url = buildChapterPracticeRoute({
      loading: this.data.loading,
      occupation,
      level,
      chapter,
      sectionId,
    });
    if (url) void wx.navigateTo({ url });
  },

  onChapterPractice() {
    const chapter = this.data.chapter;
    const occupation = this.data.occupation;
    const level = this.data.level;
    if (!chapter || !occupation || !level) return;
    const url = buildChapterPracticeRoute({
      loading: this.data.loading,
      occupation,
      level,
      chapter,
      chapterId: chapter.id,
    });
    if (url) void wx.navigateTo({ url });
  },

  onBackToAvailableCatalog() {
    const openCatalog = () => void wx.navigateTo({ url: '/pages/library/index' });
    try {
      wx.navigateBack({ delta: 1, fail: openCatalog });
    } catch {
      openCatalog();
    }
  },
});
