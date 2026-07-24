import type { CertificateLevel, OccupationCode } from './domain';

export interface CatalogSection {
  id: string;
  number: number;
  title: string;
  page: number | null;
}

export interface CatalogChapter {
  id: string;
  number: number;
  title: string;
  page: number | null;
  sections: CatalogSection[];
}

export interface CatalogPart {
  id: string;
  number: number;
  title: string;
  levels: CertificateLevel[];
  chapters: CatalogChapter[];
}

export interface CatalogOccupation {
  title: string;
  parts: CatalogPart[];
}

export interface RuntimeKnowledgeCatalog {
  occupations: Record<OccupationCode, CatalogOccupation>;
}
