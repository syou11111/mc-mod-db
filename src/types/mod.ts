export type ModStatus = 'adopted' | 'candidate' | 'deprecated';

export type ModSide = 'required' | 'optional' | 'unsupported' | 'unknown';

export type ModSource = 'modrinth' | 'curseforge';

export type ModSort = 'updated_desc' | 'downloads_desc' | 'name_asc' | 'created_desc';

export interface ModTag {
  id: string;
  name: string;
  kind: 'custom' | 'official';
  color: string;
  modCount?: number;
  parentIds: string[];
  childIds: string[];
}

export type ModRelationType = 'dependency' | 'alternative';

export interface RelatedModSummary {
  id: string;
  name: string;
  jaName: string;
  slug: string;
  iconUrl: string | null;
  loaders: string[];
  mcVersions: string[];
  supportedCombos: string[];
  modrinthId: string | null;
  modrinthSlug: string | null;
  curseforgeId: string | null;
  curseforgeSlug: string | null;
  relationType: ModRelationType;
  note: string;
}

export interface ModVersionEntry {
  id: string;
  modId: string;
  source: ModSource;
  mcVersion: string;
  loader: string;
  versionNumber: string;
  releaseType: string;
  publishedAt: string | null;
}

export interface ModRecord {
  id: string;
  name: string;
  jaName: string;
  slug: string;
  summary: string;
  note: string;
  status: ModStatus;
  modrinthId: string | null;
  modrinthSlug: string | null;
  curseforgeId: string | null;
  curseforgeSlug: string | null;
  iconUrl: string | null;
  author: string | null;
  clientSide: ModSide;
  serverSide: ModSide;
  downloads: number;
  modUpdatedAt: string | null;
  createdAt: string;
  syncedAt: string;
  tags: ModTag[];
  loaders: string[];
  mcVersions: string[];
  supportedCombos: string[];
  dependencies: RelatedModSummary[];
  alternatives: RelatedModSummary[];
  versions?: ModVersionEntry[];
}

export interface ModSearchParams {
  q?: string;
  mcVersions?: string[];
  loaders?: string[];
  andTags?: string[];
  orTags?: string[];
  notTags?: string[];
  expandMetaTags?: boolean;
  status?: ModStatus | 'all';
  clientSide?: ModSide | 'all';
  serverSide?: ModSide | 'all';
  sort?: ModSort;
}

export type PresetRequirement = 'required' | 'optional';

export interface PresetModItem {
  presetId: string;
  modId: string;
  requirement: PresetRequirement;
  note: string;
  sortOrder: number;
  mod: ModRecord;
}

export interface ModPreset {
  id: string;
  name: string;
  description: string;
  color: string;
  createdAt: string;
  updatedAt: string;
  items: PresetModItem[];
}

export interface ModSearchResponse {
  mods: ModRecord[];
  totalCount: number;
  facets: {
    mcVersions: string[];
    loaders: string[];
    tags: ModTag[];
  };
}

export interface DiscoverModItem {
  source: ModSource;
  externalId: string;
  slug: string;
  name: string;
  summary: string;
  author: string | null;
  iconUrl: string | null;
  downloads: number;
  loaders: string[];
  mcVersions: string[];
  categories: string[];
  updatedAt: string | null;
  projectUrl: string;
  alreadyInDb: boolean;
  existingModId: string | null;
}

export interface DiscoverResponse {
  items: DiscoverModItem[];
  warnings: string[];
  curseforgeConfigured: boolean;
  excludedInDbCount?: number;
}
