import {
  addModRelation,
  attachTagToMod,
  compareMcVersionsDesc,
  createOrGetTag,
  getExistingExternalIdMaps,
  getModById,
  getSetting,
  upsertExternalPayloadToStore,
} from '@/lib/db';
import type {
  DiscoverModItem,
  DiscoverResponse,
  ModRecord,
  ModSide,
  ModSource,
} from '@/types/mod';

const USER_AGENT = 'mc-mod-db/1.0.0 (local-personal-tool)';
const VALID_LOADERS = new Set([
  'fabric',
  'neoforge',
  'forge',
  'quilt',
  'liteloader',
  'rift',
  'datapack',
]);

const CF_LOADER_MAP: Record<number, string> = {
  1: 'forge',
  2: 'cauldron',
  3: 'liteloader',
  4: 'fabric',
  5: 'quilt',
  6: 'neoforge',
};

const CF_LOADER_TO_ID: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};

interface ExternalVersionInput {
  mcVersion: string;
  loader: string;
  versionNumber: string;
  releaseType: string;
  publishedAt: string | null;
}

interface ExternalModPayload {
  source: ModSource;
  externalId: string;
  slug: string;
  name: string;
  summary: string;
  author: string | null;
  iconUrl: string | null;
  clientSide: ModSide;
  serverSide: ModSide;
  downloads: number;
  updatedAt: string | null;
  categories: string[];
  versions: ExternalVersionInput[];
  requiredDependencyIds?: string[];
}

export function getCurseForgeApiKey(): string {
  const saved = getSetting('curseforge_api_key');
  if (saved && saved.trim()) return saved.trim();
  const envKey = process.env.CURSEFORGE_API_KEY;
  return envKey ? envKey.trim() : '';
}

export function parseModInput(
  rawInput: string,
  fallbackSource?: ModSource
): { source: ModSource; idOrSlug: string } {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    throw new Error('URLまたはMOD名/IDを入力してください');
  }

  if (trimmed.startsWith('modrinth:')) {
    const id = trimmed.slice('modrinth:'.length).trim();
    if (!id) throw new Error('ModrinthのIDまたはSlugが空です');
    return { source: 'modrinth', idOrSlug: id };
  }

  if (trimmed.startsWith('curseforge:')) {
    const id = trimmed.slice('curseforge:'.length).trim();
    if (!id) throw new Error('CurseForgeのIDまたはSlugが空です');
    return { source: 'curseforge', idOrSlug: id };
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      throw new Error('URLの形式が正しくありません');
    }

    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);

    if (host.includes('modrinth.com')) {
      const idx = segments.findIndex((s) =>
        ['mod', 'plugin', 'datapack', 'resourcepack', 'shader', 'modpack', 'project'].includes(
          s.toLowerCase()
        )
      );
      const idOrSlug = idx >= 0 ? segments[idx + 1] : segments[0];
      if (!idOrSlug) {
        throw new Error('Modrinth URLからプロジェクトIDを取得できませんでした');
      }
      return { source: 'modrinth', idOrSlug };
    }

    if (host.includes('curseforge.com')) {
      const idx = segments.findIndex((s) =>
        ['mc-mods', 'bukkit-plugins', 'modpacks', 'texture-packs', 'customization'].includes(
          s.toLowerCase()
        )
      );
      const idOrSlug = idx >= 0 ? segments[idx + 1] : segments[segments.length - 1];
      if (!idOrSlug) {
        throw new Error('CurseForge URLからMODスラッグを取得できませんでした');
      }
      return { source: 'curseforge', idOrSlug };
    }

    throw new Error('Modrinth または CurseForge のURLを指定してください');
  }

  if (fallbackSource) {
    return { source: fallbackSource, idOrSlug: trimmed };
  }

  if (/^\d+$/.test(trimmed)) {
    return { source: 'curseforge', idOrSlug: trimmed };
  }

  return { source: 'modrinth', idOrSlug: trimmed };
}

function normalizeSide(value: unknown): ModSide {
  if (value === 'required' || value === 'optional' || value === 'unsupported') {
    return value;
  }
  return 'unknown';
}

async function fetchJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const reqHeaders: Record<string, string> = {
    Accept: 'application/json',
    ...headers,
  };
  if (typeof window === 'undefined') {
    reqHeaders['User-Agent'] = USER_AGENT;
  }

  const res = await fetch(url, {
    headers: reqHeaders,
    cache: 'no-store',
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`外部APIエラー (${res.status}): ${text.slice(0, 180) || res.statusText}`);
  }

  return (await res.json()) as T;
}

export async function searchModrinth(params: {
  q?: string;
  mcVersion?: string;
  loader?: string;
  sort?: 'downloads' | 'relevance' | 'updated';
  limit?: number;
  offset?: number;
}): Promise<DiscoverModItem[]> {
  const facets: string[][] = [['project_type:mod']];
  if (params.mcVersion) {
    facets.push([`versions:${params.mcVersion}`]);
  }
  if (params.loader) {
    facets.push([`categories:${params.loader}`]);
  }

  const indexMap = {
    downloads: 'downloads',
    relevance: 'relevance',
    updated: 'updated',
  } as const;

  const qs = new URLSearchParams({
    query: params.q?.trim() ?? '',
    facets: JSON.stringify(facets),
    index: indexMap[params.sort ?? 'downloads'] ?? 'downloads',
    limit: String(params.limit ?? 20),
    offset: String(params.offset ?? 0),
  });

  interface ModrinthSearchHit {
    project_id: string;
    slug: string;
    title: string;
    description: string;
    author?: string;
    icon_url?: string | null;
    downloads?: number;
    categories?: string[];
    display_categories?: string[];
    versions?: string[];
    date_modified?: string;
  }

  const data = await fetchJson<{ hits?: ModrinthSearchHit[] }>(
    `https://api.modrinth.com/v2/search?${qs.toString()}`
  );

  const maps = getExistingExternalIdMaps();

  return (data.hits ?? []).map((hit) => {
    const cats = hit.categories ?? [];
    const loaders = cats.filter((c) => VALID_LOADERS.has(c.toLowerCase()));
    const nonLoaderCategories = (hit.display_categories ?? cats).filter(
      (c) => !VALID_LOADERS.has(c.toLowerCase())
    );
    const mcVersions = (hit.versions ?? []).slice().sort(compareMcVersionsDesc);

    const normalizedTitle = hit.title.replace(/\s+/g, '').toLowerCase();
    const existingModId =
      maps.byModrinthId.get(hit.project_id) ??
      maps.bySlug.get(hit.slug.toLowerCase()) ??
      maps.byNormalizedName.get(normalizedTitle) ??
      null;

    return {
      source: 'modrinth' as const,
      externalId: hit.project_id,
      slug: hit.slug,
      name: hit.title,
      summary: hit.description ?? '',
      author: hit.author ?? null,
      iconUrl: hit.icon_url ?? null,
      downloads: hit.downloads ?? 0,
      loaders,
      mcVersions,
      categories: nonLoaderCategories,
      updatedAt: hit.date_modified ?? null,
      projectUrl: `https://modrinth.com/mod/${hit.slug}`,
      alreadyInDb: Boolean(existingModId),
      existingModId,
    };
  });
}

export async function searchCurseForge(params: {
  q?: string;
  mcVersion?: string;
  loader?: string;
  sort?: 'downloads' | 'relevance' | 'updated';
  limit?: number;
  offset?: number;
}): Promise<{ items: DiscoverModItem[]; warning?: string }> {
  const apiKey = getCurseForgeApiKey();
  if (!apiKey) {
    return {
      items: [],
      warning:
        'CurseForge APIキーが未設定のため Modrinth のみ検索しました（右上の「API・設定」から設定できます）',
    };
  }

  const sortFieldMap = {
    downloads: '6',
    relevance: params.q?.trim() ? '2' : '6',
    updated: '3',
  } as const;

  const qs = new URLSearchParams({
    gameId: '432',
    classId: '6',
    pageSize: String(params.limit ?? 20),
    index: String(params.offset ?? 0),
    sortField: sortFieldMap[params.sort ?? 'downloads'] ?? '6',
    sortOrder: 'desc',
  });

  if (params.q?.trim()) {
    qs.set('searchFilter', params.q.trim());
  }
  if (params.mcVersion) {
    qs.set('gameVersion', params.mcVersion);
  }
  if (params.loader && CF_LOADER_TO_ID[params.loader.toLowerCase()]) {
    qs.set('modLoaderType', String(CF_LOADER_TO_ID[params.loader.toLowerCase()]));
  }

  interface CfMod {
    id: number;
    name: string;
    slug: string;
    summary?: string;
    downloadCount?: number;
    dateModified?: string;
    logo?: { thumbnailUrl?: string; url?: string } | null;
    authors?: Array<{ name: string }>;
    categories?: Array<{ name: string }>;
    latestFilesIndexes?: Array<{
      gameVersion?: string;
      modLoader?: number;
    }>;
    links?: { websiteUrl?: string };
  }

  const data = await fetchJson<{ data?: CfMod[] }>(
    `https://api.curseforge.com/v1/mods/search?${qs.toString()}`,
    { 'x-api-key': apiKey }
  );

  const maps = getExistingExternalIdMaps();

  const items: DiscoverModItem[] = (data.data ?? []).map((mod) => {
    const loaderSet = new Set<string>();
    const mcSet = new Set<string>();

    for (const idx of mod.latestFilesIndexes ?? []) {
      if (idx.gameVersion) mcSet.add(idx.gameVersion);
      if (idx.modLoader && CF_LOADER_MAP[idx.modLoader]) {
        loaderSet.add(CF_LOADER_MAP[idx.modLoader]);
      }
    }

    const externalId = String(mod.id);
    const normalizedName = mod.name.replace(/\s+/g, '').toLowerCase();
    const existingModId =
      maps.byCurseforgeId.get(externalId) ??
      maps.bySlug.get(mod.slug.toLowerCase()) ??
      maps.byNormalizedName.get(normalizedName) ??
      null;

    return {
      source: 'curseforge' as const,
      externalId,
      slug: mod.slug,
      name: mod.name,
      summary: mod.summary ?? '',
      author: mod.authors?.[0]?.name ?? null,
      iconUrl: mod.logo?.thumbnailUrl ?? mod.logo?.url ?? null,
      downloads: mod.downloadCount ?? 0,
      loaders: Array.from(loaderSet).sort(),
      mcVersions: Array.from(mcSet).sort(compareMcVersionsDesc),
      categories: Array.from(
        new Set((mod.categories ?? []).map((c) => c.name).filter(Boolean))
      ),
      updatedAt: mod.dateModified ?? null,
      projectUrl:
        mod.links?.websiteUrl ?? `https://www.curseforge.com/minecraft/mc-mods/${mod.slug}`,
      alreadyInDb: Boolean(existingModId),
      existingModId,
    };
  });

  return { items };
}

export async function discoverExternalMods(params: {
  source?: 'all' | ModSource;
  q?: string;
  mcVersion?: string;
  loader?: string;
  sort?: 'downloads' | 'relevance' | 'updated';
  limit?: number;
  offset?: number;
  excludeInDb?: boolean;
}): Promise<DiscoverResponse> {
  const source = params.source ?? 'all';
  const cfConfigured = Boolean(getCurseForgeApiKey());
  const warnings: string[] = [];
  let items: DiscoverModItem[] = [];
  const reqLimit = params.limit ?? 24;
  const excludeInDb = Boolean(params.excludeInDb);

  if (source === 'all' || source === 'modrinth') {
    try {
      const mrItems = await searchModrinth({
        ...params,
        limit: excludeInDb ? Math.min(80, reqLimit * 3) : reqLimit,
      });
      items.push(...mrItems);
    } catch (err) {
      warnings.push(
        `Modrinth 検索エラー: ${err instanceof Error ? err.message : '取得に失敗しました'}`
      );
    }
  }

  if (source === 'all' || source === 'curseforge') {
    try {
      const cfResult = await searchCurseForge({
        ...params,
        limit: excludeInDb ? Math.min(50, reqLimit * 2) : reqLimit,
      });
      items.push(...cfResult.items);
      if (cfResult.warning) warnings.push(cfResult.warning);
    } catch (err) {
      warnings.push(
        `CurseForge 検索エラー: ${err instanceof Error ? err.message : '取得に失敗しました'}`
      );
    }
  }

  if (params.sort === 'downloads') {
    items.sort((a, b) => b.downloads - a.downloads);
  } else if (params.sort === 'updated') {
    items.sort((a, b) =>
      (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '')
    );
  }

  let excludedInDbCount = 0;
  if (excludeInDb) {
    excludedInDbCount = items.filter((item) => item.alreadyInDb).length;
    const maxTotal = source === 'all' ? reqLimit * 2 : reqLimit;
    items = items.filter((item) => !item.alreadyInDb).slice(0, maxTotal);
  }

  return {
    items,
    warnings,
    curseforgeConfigured: cfConfigured,
    excludedInDbCount,
  };
}

async function fetchModrinthProjectAndVersions(
  idOrSlug: string
): Promise<ExternalModPayload> {
  interface MrProject {
    id: string;
    slug: string;
    title: string;
    description?: string;
    icon_url?: string | null;
    client_side?: string;
    server_side?: string;
    downloads?: number;
    updated?: string;
    categories?: string[];
    additional_categories?: string[];
  }

  interface MrVersion {
    version_number: string;
    version_type?: string;
    game_versions?: string[];
    loaders?: string[];
    date_published?: string;
    dependencies?: Array<{
      project_id?: string | null;
      dependency_type?: string;
    }>;
  }

  const encoded = encodeURIComponent(idOrSlug);
  const [project, versions] = await Promise.all([
    fetchJson<MrProject>(`https://api.modrinth.com/v2/project/${encoded}`),
    fetchJson<MrVersion[]>(`https://api.modrinth.com/v2/project/${encoded}/version`),
  ]);

  const sortedVersions = [...versions].sort((a, b) =>
    (b.date_published ?? '').localeCompare(a.date_published ?? '')
  );

  const requiredDependencyIds: string[] = [];
  for (const v of sortedVersions.slice(0, 15)) {
    for (const dep of v.dependencies ?? []) {
      if (
        dep.dependency_type === 'required' &&
        dep.project_id &&
        dep.project_id !== project.id &&
        !requiredDependencyIds.includes(dep.project_id)
      ) {
        requiredDependencyIds.push(dep.project_id);
      }
    }
    if (requiredDependencyIds.length >= 6) break;
  }

  const versionMap = new Map<string, ExternalVersionInput>();
  for (const v of sortedVersions) {
    const loaders = (v.loaders ?? [])
      .map((l) => l.toLowerCase())
      .filter((l) => VALID_LOADERS.has(l));
    const mcVersions = v.game_versions ?? [];
    const releaseType = v.version_type ?? 'release';

    for (const mcVersion of mcVersions) {
      for (const loader of loaders) {
        const key = `${mcVersion}::${loader}`;
        const existing = versionMap.get(key);
        if (!existing) {
          versionMap.set(key, {
            mcVersion,
            loader,
            versionNumber: v.version_number,
            releaseType,
            publishedAt: v.date_published ?? null,
          });
        } else if (existing.releaseType !== 'release' && releaseType === 'release') {
          versionMap.set(key, {
            mcVersion,
            loader,
            versionNumber: v.version_number,
            releaseType,
            publishedAt: v.date_published ?? null,
          });
        }
      }
    }
  }

  const categories = Array.from(
    new Set([...(project.categories ?? []), ...(project.additional_categories ?? [])])
  ).filter((c) => !VALID_LOADERS.has(c.toLowerCase()));

  return {
    source: 'modrinth',
    externalId: project.id,
    slug: project.slug,
    name: project.title,
    summary: project.description ?? '',
    author: null,
    iconUrl: project.icon_url ?? null,
    clientSide: normalizeSide(project.client_side),
    serverSide: normalizeSide(project.server_side),
    downloads: project.downloads ?? 0,
    updatedAt: project.updated ?? null,
    categories,
    versions: Array.from(versionMap.values()),
    requiredDependencyIds,
  };
}

interface CfModData {
  id: number;
  name: string;
  slug: string;
  summary?: string;
  downloadCount?: number;
  dateModified?: string;
  logo?: { thumbnailUrl?: string; url?: string } | null;
  authors?: Array<{ name: string }>;
  categories?: Array<{ name: string }>;
  latestFiles?: Array<{
    displayName?: string;
    fileName?: string;
    fileDate?: string;
    releaseType?: number;
    gameVersions?: string[];
    dependencies?: Array<{
      modId?: number;
      relationType?: number;
    }>;
  }>;
  latestFilesIndexes?: Array<{
    gameVersion?: string;
    filename?: string;
    releaseType?: number;
    modLoader?: number;
  }>;
}

function buildCurseForgePayloadFromModData(
  mod: CfModData,
  extraFiles?: CfModData['latestFiles']
): ExternalModPayload {
  const releaseMap: Record<number, string> = {
    1: 'release',
    2: 'beta',
    3: 'alpha',
  };

  const versionMap = new Map<string, ExternalVersionInput>();

  for (const idx of mod.latestFilesIndexes ?? []) {
    const mcVersion = idx.gameVersion;
    const loader = idx.modLoader ? CF_LOADER_MAP[idx.modLoader] : undefined;
    if (!mcVersion || !loader) continue;
    const key = `${mcVersion}::${loader}`;
    const releaseType = releaseMap[idx.releaseType ?? 1] ?? 'release';
    const existing = versionMap.get(key);
    if (!existing || (existing.releaseType !== 'release' && releaseType === 'release')) {
      versionMap.set(key, {
        mcVersion,
        loader,
        versionNumber: idx.filename ?? 'latest',
        releaseType,
        publishedAt: mod.dateModified ?? null,
      });
    }
  }

  const allFiles = [...(extraFiles ?? []), ...(mod.latestFiles ?? [])];
  const requiredDependencyIds: string[] = [];
  const selfIdStr = String(mod.id);

  for (const file of allFiles) {
    for (const dep of file.dependencies ?? []) {
      if (dep.relationType === 3 && dep.modId) {
        const depIdStr = String(dep.modId);
        if (depIdStr !== selfIdStr && !requiredDependencyIds.includes(depIdStr)) {
          requiredDependencyIds.push(depIdStr);
        }
      }
    }
    const gvs = file.gameVersions ?? [];
    const loaders = gvs
      .map((v) => v.toLowerCase())
      .filter((v) => VALID_LOADERS.has(v));
    const mcVers = gvs.filter((v) => /^\d+\.\d+/.test(v));
    const releaseType = releaseMap[file.releaseType ?? 1] ?? 'release';
    for (const mcVersion of mcVers) {
      for (const loader of loaders) {
        const key = `${mcVersion}::${loader}`;
        if (!versionMap.has(key)) {
          versionMap.set(key, {
            mcVersion,
            loader,
            versionNumber: file.displayName ?? file.fileName ?? 'file',
            releaseType,
            publishedAt: file.fileDate ?? mod.dateModified ?? null,
          });
        }
      }
    }
  }

  const categories = Array.from(
    new Set((mod.categories ?? []).map((c) => c.name).filter(Boolean))
  );

  return {
    source: 'curseforge',
    externalId: selfIdStr,
    slug: mod.slug,
    name: mod.name,
    summary: mod.summary ?? '',
    author: mod.authors?.[0]?.name ?? null,
    iconUrl: mod.logo?.thumbnailUrl ?? mod.logo?.url ?? null,
    clientSide: 'unknown',
    serverSide: 'unknown',
    downloads: mod.downloadCount ?? 0,
    updatedAt: mod.dateModified ?? null,
    categories,
    versions: Array.from(versionMap.values()),
    requiredDependencyIds: requiredDependencyIds.slice(0, 6),
  };
}

async function fetchCurseForgeMod(
  idOrSlug: string,
  options?: { lightweight?: boolean }
): Promise<ExternalModPayload> {
  const apiKey = getCurseForgeApiKey();
  if (!apiKey) {
    throw new Error(
      'CurseForge のデータを取得するには APIキーが必要です（右上の「API・設定」から設定してください）'
    );
  }

  let mod: CfModData | undefined;
  if (/^\d+$/.test(idOrSlug.trim())) {
    const res = await fetchJson<{ data: CfModData }>(
      `https://api.curseforge.com/v1/mods/${idOrSlug.trim()}`,
      { 'x-api-key': apiKey }
    );
    mod = res.data;
  } else {
    const qs = new URLSearchParams({
      gameId: '432',
      classId: '6',
      slug: idOrSlug.trim().toLowerCase(),
    });
    const res = await fetchJson<{ data?: CfModData[] }>(
      `https://api.curseforge.com/v1/mods/search?${qs.toString()}`,
      { 'x-api-key': apiKey }
    );
    mod =
      res.data?.find((m) => m.slug.toLowerCase() === idOrSlug.trim().toLowerCase()) ??
      res.data?.[0];
  }

  if (!mod) {
    throw new Error(`CurseForge で MOD (${idOrSlug}) が見つかりませんでした`);
  }

  // latestFilesIndexes + latestFiles が既に含まれている場合は追加の /files API 呼び出しを省略して高速化
  let extraFiles: CfModData['latestFiles'];
  const hasIndexes = (mod.latestFilesIndexes?.length ?? 0) > 0;
  if (!options?.lightweight && !hasIndexes) {
    try {
      const filesRes = await fetchJson<{ data?: CfModData['latestFiles'] }>(
        `https://api.curseforge.com/v1/mods/${mod.id}/files?pageSize=30`,
        { 'x-api-key': apiKey }
      );
      extraFiles = filesRes.data;
    } catch {
      // latestFiles だけで継続可能
    }
  }

  return buildCurseForgePayloadFromModData(mod, extraFiles);
}

function upsertExternalPayload(
  payload: ExternalModPayload,
  options: { initialTagIds?: string[]; mergeIntoModId?: string } = {}
): { mod: ModRecord; action: 'created' | 'updated' | 'merged' } {
  return upsertExternalPayloadToStore(payload, options);
}

export interface LinkedDependencyInfo {
  id: string;
  name: string;
  newlyImported: boolean;
}

function normalizeModNameForMatch(name: string): string {
  return name
    .replace(/\((?:fabric|forge|neoforge|quilt)[^)]*\)/gi, '')
    .replace(/\[(?:fabric|forge|neoforge|quilt)[^\]]*\]/gi, '')
    .replace(/[^a-zA-Z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '')
    .toLowerCase();
}

function normalizeCoreModName(name: string): string {
  const core = name.split(/\s+[-–—:|]\s+|\s*[:|]\s*/)[0] ?? name;
  return normalizeModNameForMatch(core);
}

function isModNameCompatible(nameA: string, nameB: string): boolean {
  const normA = normalizeModNameForMatch(nameA);
  const normB = normalizeModNameForMatch(nameB);
  if (!normA || !normB) return false;
  if (normA === normB) return true;

  const coreA = normalizeCoreModName(nameA);
  const coreB = normalizeCoreModName(nameB);
  if (coreA && coreB && coreA === coreB && coreA.length >= 3) {
    return true;
  }
  return false;
}

/**
 * 片方のプラットフォーム（Modrinth または CurseForge）しか紐付いていないMODについて、
 * もう片方のプラットフォームにも同一MODが存在する場合は自動で検索・統合します（Soft-fail）。
 */
async function tryMatchAndMergeCounterpart(
  mod: ModRecord
): Promise<ModSource | null> {
  const targetAuthor = mod.author?.trim().toLowerCase() ?? '';
  const maps = getExistingExternalIdMaps();

  // 1. Modrinth -> CurseForge
  if (mod.modrinthId && !mod.curseforgeId) {
    const apiKey = getCurseForgeApiKey();
    if (!apiKey) return null;

    const slugCandidate = (mod.modrinthSlug ?? mod.slug).trim().toLowerCase();
    let matchedCfMod: CfModData | undefined;

    if (slugCandidate) {
      const slugQs = new URLSearchParams({
        gameId: '432',
        classId: '6',
        slug: slugCandidate,
      });
      const slugRes = await fetchJson<{ data?: CfModData[] }>(
        `https://api.curseforge.com/v1/mods/search?${slugQs.toString()}`,
        { 'x-api-key': apiKey }
      );
      matchedCfMod = (slugRes.data ?? []).find(
        (m) => m.slug.toLowerCase() === slugCandidate
      );
    }

    if (!matchedCfMod) {
      const nameQs = new URLSearchParams({
        gameId: '432',
        classId: '6',
        searchFilter: mod.name,
        pageSize: '15',
      });
      const nameRes = await fetchJson<{ data?: CfModData[] }>(
        `https://api.curseforge.com/v1/mods/search?${nameQs.toString()}`,
        { 'x-api-key': apiKey }
      );
      const candidates = nameRes.data ?? [];
      matchedCfMod =
        candidates.find((m) => {
          if (m.slug.toLowerCase() === slugCandidate) return true;
          const authorMatch =
            Boolean(targetAuthor) &&
            (m.authors ?? []).some((a) => a.name.toLowerCase() === targetAuthor);
          return isModNameCompatible(m.name, mod.name) && authorMatch;
        }) ??
        candidates.find((m) => isModNameCompatible(m.name, mod.name));
    }

    if (matchedCfMod) {
      const matchedCfId = String(matchedCfMod.id);
      const existingOwner = maps.byCurseforgeId.get(matchedCfId);
      if (existingOwner && existingOwner !== mod.id) {
        return null;
      }
      // 検索結果に既に latestFilesIndexes と latestFiles が含まれているため、再取得せずそのままペイロード構築
      const cfPayload = buildCurseForgePayloadFromModData(matchedCfMod);
      upsertExternalPayload(cfPayload, { mergeIntoModId: mod.id });
      return 'curseforge';
    }
    return null;
  }

  // 2. CurseForge -> Modrinth
  if (mod.curseforgeId && !mod.modrinthId) {
    const slugCandidate = (mod.curseforgeSlug ?? mod.slug).trim().toLowerCase();
    let matchedMrId: string | null = null;

    if (slugCandidate) {
      try {
        const res = await fetch(
          `https://api.modrinth.com/v2/project/${encodeURIComponent(slugCandidate)}`,
          {
            headers: { 'User-Agent': USER_AGENT },
            cache: 'no-store',
          }
        );
        if (res.ok) {
          const proj = (await res.json()) as {
            id?: string;
            slug?: string;
            title?: string;
            project_type?: string;
          };
          if (proj?.id && proj.project_type === 'mod') {
            matchedMrId = proj.id;
          }
        }
      } catch {
        // fallback to search
      }
    }

    if (!matchedMrId) {
      interface MrSearchHit {
        project_id: string;
        slug: string;
        title: string;
        author?: string;
      }
      const qs = new URLSearchParams({
        query: mod.name,
        facets: JSON.stringify([['project_type:mod']]),
        limit: '15',
      });
      const searchRes = await fetchJson<{ hits?: MrSearchHit[] }>(
        `https://api.modrinth.com/v2/search?${qs.toString()}`
      );
      const hits = searchRes.hits ?? [];
      const exactHit =
        hits.find((h) => {
          if (h.slug.toLowerCase() === slugCandidate) return true;
          const authorMatch =
            Boolean(targetAuthor) &&
            Boolean(h.author) &&
            h.author!.toLowerCase() === targetAuthor;
          return isModNameCompatible(h.title, mod.name) && authorMatch;
        }) ?? hits.find((h) => isModNameCompatible(h.title, mod.name));

      if (exactHit) {
        matchedMrId = exactHit.project_id;
      }
    }

    if (matchedMrId) {
      const existingOwner = maps.byModrinthId.get(matchedMrId);
      if (existingOwner && existingOwner !== mod.id) {
        return null;
      }
      const mrPayload = await fetchModrinthProjectAndVersions(matchedMrId);
      upsertExternalPayload(mrPayload, { mergeIntoModId: mod.id });
      return 'modrinth';
    }
    return null;
  }

  return null;
}

export async function importModFromExternal(params: {
  source?: ModSource;
  idOrSlug?: string;
  input?: string;
  initialTagIds?: string[];
  mergeIntoModId?: string;
  autoLinkDependencies?: boolean;
  autoMatchCounterpart?: boolean;
}): Promise<{
  mod: ModRecord;
  action: 'created' | 'updated' | 'merged';
  linkedDependencies: LinkedDependencyInfo[];
  matchedCounterpart: ModSource | null;
  requiredDependencyIds?: string[];
}> {
  const parsed = params.input
    ? parseModInput(params.input, params.source)
    : params.source && params.idOrSlug
      ? { source: params.source, idOrSlug: params.idOrSlug }
      : null;

  if (!parsed) {
    throw new Error('インポート対象のURLまたはIDを指定してください');
  }

  const payload =
    parsed.source === 'modrinth'
      ? await fetchModrinthProjectAndVersions(parsed.idOrSlug)
      : await fetchCurseForgeMod(parsed.idOrSlug);

  const result = upsertExternalPayload(payload, {
    initialTagIds: params.initialTagIds,
    mergeIntoModId: params.mergeIntoModId,
  });

  let finalMod = result.mod;
  let matchedCounterpart: ModSource | null = null;

  if (params.autoMatchCounterpart !== false) {
    try {
      matchedCounterpart = await tryMatchAndMergeCounterpart(finalMod);
      if (matchedCounterpart) {
        finalMod = getModById(finalMod.id) ?? finalMod;
      }
    } catch {
      // Soft-fail: 対向プラットフォームの自動照合に失敗しても本体登録は成功させる
    }
  }

  let linkedDependencies: LinkedDependencyInfo[] = [];

  if (params.autoLinkDependencies) {
    try {
      const depRes = await fetchAndLinkDependenciesForMod(result.mod.id, {
        maxDepth: 2,
        preFetchedDependencies: payload.requiredDependencyIds
          ? {
              source: parsed.source,
              ids: payload.requiredDependencyIds,
            }
          : undefined,
      });
      finalMod = depRes.mod;
      linkedDependencies = depRes.linkedMods;
    } catch {
      // Soft-fail: 前提MOD取得で一部失敗しても本体登録は成功させる
    }
  }

  return {
    mod: finalMod,
    action: result.action,
    linkedDependencies,
    matchedCounterpart,
    requiredDependencyIds: payload.requiredDependencyIds,
  };
}

export async function syncModById(modId: string): Promise<ModRecord> {
  const current = getModById(modId);
  if (!current) {
    throw new Error('対象のMODがDBに存在しません');
  }

  const cfKey = getCurseForgeApiKey();

  // Modrinth と CurseForge の取得を並列実行して待ち時間を半減
  const [mrPayload, cfPayload] = await Promise.all([
    current.modrinthId
      ? fetchModrinthProjectAndVersions(current.modrinthId)
      : Promise.resolve(null),
    current.curseforgeId && cfKey
      ? fetchCurseForgeMod(current.curseforgeId, { lightweight: true })
      : Promise.resolve(null),
  ]);

  if (mrPayload) {
    upsertExternalPayload(mrPayload, { mergeIntoModId: modId });
  }
  if (cfPayload) {
    upsertExternalPayload(cfPayload, { mergeIntoModId: modId });
  }

  const afterPrimarySync = getModById(modId);
  if (afterPrimarySync && (!afterPrimarySync.modrinthId || !afterPrimarySync.curseforgeId)) {
    try {
      await tryMatchAndMergeCounterpart(afterPrimarySync);
    } catch {
      // Soft-fail
    }
  }

  const updated = getModById(modId);
  if (!updated) {
    throw new Error('同期後のMOD読み込みに失敗しました');
  }
  return updated;
}

const MAX_LINKED_DEPENDENCIES = 8;

/**
 * 対象MODの必須前提MOD (Modrinth required / CurseForge relationType=3) を外部APIから検出し、
 * 未登録のMODは自動インポートして「前提MOD」タグ付与・依存関係リンクを作成します (最大深さ maxDepth)。
 */
export async function fetchAndLinkDependenciesForMod(
  modId: string,
  options?: {
    maxDepth?: number;
    visitedModIds?: Set<string>;
    preFetchedDependencies?: { source: ModSource; ids: string[] };
  }
): Promise<{
  mod: ModRecord;
  linkedMods: LinkedDependencyInfo[];
}> {
  const current = getModById(modId);
  if (!current) {
    throw new Error('対象のMODがDBに存在しません');
  }

  const maxDepth = options?.maxDepth ?? 2;
  const visitedModIds = options?.visitedModIds ?? new Set<string>();
  visitedModIds.add(modId);

  const linkedMods: LinkedDependencyInfo[] = [];
  const linkedModIdSet = new Set<string>();
  const directTargetIds = new Set<string>();

  async function processSingleDependency(
    source: ModSource,
    externalId: string,
    relationNote: string
  ): Promise<void> {
    if (linkedMods.length >= MAX_LINKED_DEPENDENCIES) return;

    try {
      const maps = getExistingExternalIdMaps();
      let depLocalId =
        source === 'modrinth'
          ? maps.byModrinthId.get(externalId)
          : maps.byCurseforgeId.get(externalId);
      let newlyImported = false;
      let wasAlreadyInDb = Boolean(depLocalId);
      let depName = '';
      let subRequiredIds: string[] | undefined;

      if (!depLocalId) {
        const res = await importModFromExternal({
          source,
          idOrSlug: externalId,
          autoLinkDependencies: false,
          // 前提MODの自動取得時は対向プラットフォーム検索をスキップして高速化
          autoMatchCounterpart: false,
        });
        depLocalId = res.mod.id;
        depName = res.mod.name;
        newlyImported = res.action === 'created';
        wasAlreadyInDb = !newlyImported;
        subRequiredIds = res.requiredDependencyIds;

        if (newlyImported) {
          const prereqTag = createOrGetTag('前提MOD', 'custom', '#64748b');
          attachTagToMod(depLocalId, prereqTag.id);
        }
      } else {
        depName = getModById(depLocalId)?.name ?? externalId;
      }

      if (depLocalId && depLocalId !== modId && !directTargetIds.has(depLocalId)) {
        addModRelation(modId, depLocalId, 'dependency', relationNote);
        directTargetIds.add(depLocalId);

        if (!linkedModIdSet.has(depLocalId)) {
          linkedModIdSet.add(depLocalId);
          linkedMods.push({ id: depLocalId, name: depName, newlyImported });
        }

        if (
          !wasAlreadyInDb &&
          maxDepth > 1 &&
          !visitedModIds.has(depLocalId) &&
          linkedMods.length < MAX_LINKED_DEPENDENCIES
        ) {
          try {
            const subRes = await fetchAndLinkDependenciesForMod(depLocalId, {
              maxDepth: maxDepth - 1,
              visitedModIds,
              preFetchedDependencies: subRequiredIds
                ? { source, ids: subRequiredIds }
                : undefined,
            });
            for (const sub of subRes.linkedMods) {
              if (linkedMods.length >= MAX_LINKED_DEPENDENCIES) break;
              if (sub.id !== modId && !linkedModIdSet.has(sub.id)) {
                linkedModIdSet.add(sub.id);
                linkedMods.push(sub);
              }
            }
          } catch {
            // Soft-fail: 孫前提MODの探索失敗時は親リンクを維持して継続
          }
        }
      }
    } catch {
      // Soft-fail: 個別の前提MOD取得・登録エラーでは全体を止めない
    }
  }

  const preFetched = options?.preFetchedDependencies;

  if (preFetched && preFetched.ids.length > 0) {
    const note =
      preFetched.source === 'modrinth'
        ? 'API自動検出 (Modrinth)'
        : 'API自動検出 (CurseForge)';
    await Promise.all(
      preFetched.ids.slice(0, 6).map((depId) =>
        processSingleDependency(preFetched.source, depId, note)
      )
    );
  } else {
    if (current.modrinthId) {
      interface MrVerDep {
        date_published?: string;
        dependencies?: Array<{
          project_id?: string | null;
          dependency_type?: string;
        }>;
      }

      const encoded = encodeURIComponent(current.modrinthId);
      const versions = await fetchJson<MrVerDep[]>(
        `https://api.modrinth.com/v2/project/${encoded}/version`
      );

      const sorted = [...versions].sort((a, b) =>
        (b.date_published ?? '').localeCompare(a.date_published ?? '')
      );

      const depProjectIds: string[] = [];
      for (const v of sorted.slice(0, 15)) {
        for (const dep of v.dependencies ?? []) {
          if (
            dep.dependency_type === 'required' &&
            dep.project_id &&
            dep.project_id !== current.modrinthId &&
            !depProjectIds.includes(dep.project_id)
          ) {
            depProjectIds.push(dep.project_id);
          }
        }
        if (depProjectIds.length >= 6) break;
      }

      await Promise.all(
        depProjectIds.slice(0, 6).map((depProjectId) =>
          processSingleDependency('modrinth', depProjectId, 'API自動検出 (Modrinth)')
        )
      );
    }

    const apiKey = getCurseForgeApiKey();
    if (current.curseforgeId && apiKey && linkedMods.length === 0) {
      interface CfFileDep {
        dependencies?: Array<{
          modId?: number;
          relationType?: number;
        }>;
      }

      try {
        const filesRes = await fetchJson<{ data?: CfFileDep[] }>(
          `https://api.curseforge.com/v1/mods/${current.curseforgeId}/files?pageSize=10`,
          { 'x-api-key': apiKey }
        );

        const cfDepIds: string[] = [];
        for (const file of filesRes.data ?? []) {
          for (const dep of file.dependencies ?? []) {
            if (dep.relationType === 3 && dep.modId) {
              const idStr = String(dep.modId);
              if (idStr !== current.curseforgeId && !cfDepIds.includes(idStr)) {
                cfDepIds.push(idStr);
              }
            }
          }
          if (cfDepIds.length >= 6) break;
        }

        await Promise.all(
          cfDepIds.slice(0, 6).map((cfDepId) =>
            processSingleDependency('curseforge', cfDepId, 'API自動検出 (CurseForge)')
          )
        );
      } catch {
        // Modrinth側で解決できていればエラーにせず継続
      }
    }
  }

  const updated = getModById(modId);
  if (!updated) {
    throw new Error('前提MODの紐付け後の読み込みに失敗しました');
  }

  return { mod: updated, linkedMods };
}

