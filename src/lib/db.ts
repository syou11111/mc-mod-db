import type {
  ModPreset,
  ModRecord,
  ModRelationType,
  ModSearchParams,
  ModSearchResponse,
  ModSide,
  ModSource,
  ModStatus,
  ModTag,
  ModVersionEntry,
  PresetModItem,
  PresetRequirement,
  RelatedModSummary,
} from '@/types/mod';

export interface ModRow {
  id: string;
  name: string;
  ja_name: string;
  slug: string;
  summary: string;
  note: string;
  status: ModStatus;
  modrinth_id: string | null;
  modrinth_slug: string | null;
  curseforge_id: string | null;
  curseforge_slug: string | null;
  icon_url: string | null;
  author: string | null;
  client_side: ModSide;
  server_side: ModSide;
  downloads: number;
  mod_updated_at: string | null;
  created_at: string;
  synced_at: string;
}

export interface ModVersionRow {
  id: string;
  mod_id: string;
  source: ModSource;
  mc_version: string;
  loader: string;
  version_number: string;
  release_type: string;
  published_at: string | null;
}

export interface TagRow {
  id: string;
  name: string;
  kind: 'custom' | 'official';
  color: string;
  created_at: string;
}

export interface ModTagRow {
  mod_id: string;
  tag_id: string;
}

export interface TagRelationRow {
  parent_tag_id: string;
  child_tag_id: string;
}

export interface ModRelationRow {
  mod_id: string;
  related_mod_id: string;
  relation_type: ModRelationType;
  note: string;
  created_at: string;
}

export interface PresetRow {
  id: string;
  name: string;
  description: string;
  color: string;
  created_at: string;
  updated_at: string;
}

export interface PresetItemRow {
  preset_id: string;
  mod_id: string;
  requirement: PresetRequirement;
  note: string;
  sort_order: number;
}

export interface DatabaseSnapshot {
  version: 1;
  exportedAt: string;
  mods: ModRow[];
  modVersions: ModVersionRow[];
  tags: TagRow[];
  modTags: ModTagRow[];
  tagRelations: TagRelationRow[];
  modRelations: ModRelationRow[];
  presets: PresetRow[];
  presetItems: PresetItemRow[];
}

export interface ExternalVersionInput {
  mcVersion: string;
  loader: string;
  versionNumber: string;
  releaseType: string;
  publishedAt: string | null;
}

export interface ExternalModPayloadInput {
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
}

const IDB_NAME = 'mc-mod-db-v1';
const IDB_STORE = 'snapshots';
const IDB_KEY = 'main';
const SETTINGS_PREFIX = 'mc_mod_db_setting_';

const DEFAULT_CUSTOM_TAGS: Array<{ name: string; color: string }> = [
  { name: '軽量化', color: '#10b981' },
  { name: '工業', color: '#f59e0b' },
  { name: '魔術', color: '#a855f7' },
  { name: '建築・装飾', color: '#ec4899' },
  { name: 'UI・便利系', color: '#3b82f6' },
  { name: '冒険・ディメンション', color: '#ef4444' },
  { name: '前提MOD', color: '#64748b' },
  { name: '日本語化あり', color: '#06b6d4' },
  { name: '必須級', color: '#eab308' },
];

function createEmptySnapshot(withDefaultTags = true): DatabaseSnapshot {
  const now = new Date().toISOString();
  return {
    version: 1,
    exportedAt: now,
    mods: [],
    modVersions: [],
    tags: withDefaultTags
      ? DEFAULT_CUSTOM_TAGS.map((t) => ({
          id: randomUuid(),
          name: t.name,
          kind: 'custom' as const,
          color: t.color,
          created_at: now,
        }))
      : [],
    modTags: [],
    tagRelations: [],
    modRelations: [],
    presets: [],
    presetItems: [],
  };
}

function randomUuid(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let snapshotState: DatabaseSnapshot = createEmptySnapshot(true);
const memorySettings = new Map<string, string>();
let initPromise: Promise<void> | null = null;
let persistChain: Promise<void> = Promise.resolve();
const mutationListeners = new Set<() => void>();

export function subscribeDbMutations(listener: () => void): () => void {
  mutationListeners.add(listener);
  return () => {
    mutationListeners.delete(listener);
  };
}

function openIndexedDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = globalThis.indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function readSnapshotFromIndexedDb(): Promise<DatabaseSnapshot | null> {
  if (typeof globalThis.indexedDB === 'undefined') return null;
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(IDB_KEY);
    req.onsuccess = () => {
      resolve((req.result as DatabaseSnapshot | undefined) ?? null);
    };
    req.onerror = () => reject(req.error ?? new Error('IndexedDB read failed'));
    tx.oncomplete = () => db.close();
  });
}

async function writeSnapshotToIndexedDb(snapshot: DatabaseSnapshot): Promise<void> {
  if (typeof globalThis.indexedDB === 'undefined') return;
  const db = await openIndexedDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(snapshot, IDB_KEY);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB write failed'));
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      db.close();
      reject(tx.error ?? new Error('IndexedDB transaction failed'));
    };
  });
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingNotifyAutoSync = false;

function schedulePersist(notifyAutoSync = true): Promise<void> {
  if (notifyAutoSync) {
    pendingNotifyAutoSync = true;
  }

  if (persistTimer) {
    clearTimeout(persistTimer);
  }

  return new Promise((resolve) => {
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const shouldNotify = pendingNotifyAutoSync;
      pendingNotifyAutoSync = false;

      if (shouldNotify && typeof window !== 'undefined') {
        for (const listener of mutationListeners) {
          try {
            listener();
          } catch {
            // ignore listener errors
          }
        }
      }

      if (typeof globalThis.indexedDB === 'undefined') {
        resolve();
        return;
      }

      const clone: DatabaseSnapshot = {
        ...snapshotState,
        exportedAt: new Date().toISOString(),
      };
      persistChain = persistChain
        .then(() => writeSnapshotToIndexedDb(clone))
        .catch((err) => {
          console.error('Failed to persist IndexedDB snapshot:', err);
        });
      void persistChain.then(resolve);
    }, 60);
  });
}

function normalizeSnapshot(raw: Partial<DatabaseSnapshot>): DatabaseSnapshot {
  const now = new Date().toISOString();
  return {
    version: 1,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : now,
    mods: Array.isArray(raw.mods)
      ? raw.mods.map((m) => ({
          ...m,
          ja_name: m.ja_name ?? '',
          summary: m.summary ?? '',
          note: m.note ?? '',
          status: m.status || 'candidate',
          modrinth_id: m.modrinth_id ?? null,
          modrinth_slug: m.modrinth_slug ?? null,
          curseforge_id: m.curseforge_id ?? null,
          curseforge_slug: m.curseforge_slug ?? null,
          icon_url: m.icon_url ?? null,
          author: m.author ?? null,
          client_side: m.client_side || 'unknown',
          server_side: m.server_side || 'unknown',
          downloads: Number(m.downloads ?? 0),
          mod_updated_at: m.mod_updated_at ?? null,
          created_at: m.created_at ?? now,
          synced_at: m.synced_at ?? now,
        }))
      : [],
    modVersions: Array.isArray(raw.modVersions) ? raw.modVersions : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    modTags: Array.isArray(raw.modTags) ? raw.modTags : [],
    tagRelations: Array.isArray(raw.tagRelations) ? raw.tagRelations : [],
    modRelations: Array.isArray(raw.modRelations) ? raw.modRelations : [],
    presets: Array.isArray(raw.presets) ? raw.presets : [],
    presetItems: Array.isArray(raw.presetItems) ? raw.presetItems : [],
  };
}

export async function ensureDbInitialized(): Promise<void> {
  if (typeof window === 'undefined' || typeof globalThis.indexedDB === 'undefined') {
    return;
  }
  if (!initPromise) {
    initPromise = (async () => {
      try {
        const stored = await readSnapshotFromIndexedDb();
        if (stored && Array.isArray(stored.mods)) {
          snapshotState = normalizeSnapshot(stored);
          return;
        }

        // 初回起動時: localhost の場合は既存 data/mods.db から書き出した local-seed.json を自動移行
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
          try {
            const res = await fetch('/local-seed.json', { cache: 'no-store' });
            if (res.ok) {
              const seed = (await res.json()) as Partial<DatabaseSnapshot> & {
                localSettings?: Record<string, string>;
              };
              if (Array.isArray(seed.mods)) {
                snapshotState = normalizeSnapshot(seed);
                if (seed.localSettings) {
                  for (const [k, v] of Object.entries(seed.localSettings)) {
                    if (v && !getSetting(k)) {
                      setSetting(k, v);
                    }
                  }
                }
                await writeSnapshotToIndexedDb(snapshotState);
                return;
              }
            }
          } catch {
            // Seed file missing -> initialize default empty snapshot
          }
        }

        snapshotState = createEmptySnapshot(true);
        await writeSnapshotToIndexedDb(snapshotState);
      } catch (err) {
        console.error('IndexedDB initialization error, falling back to memory:', err);
      }
    })();
  }
  return initPromise;
}

export function exportDatabaseSnapshot(): DatabaseSnapshot {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    mods: [...snapshotState.mods],
    modVersions: [...snapshotState.modVersions],
    tags: [...snapshotState.tags],
    modTags: [...snapshotState.modTags],
    tagRelations: [...snapshotState.tagRelations],
    modRelations: [...snapshotState.modRelations],
    presets: [...snapshotState.presets],
    presetItems: [...snapshotState.presetItems],
  };
}

export async function importDatabaseSnapshot(
  raw: Partial<DatabaseSnapshot>
): Promise<{ mods: number; versions: number; tags: number; presets: number }> {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.mods)) {
    throw new Error('有効なデータベースJSON形式ではありません');
  }
  snapshotState = normalizeSnapshot(raw);
  await schedulePersist(false);
  return getDbStats();
}

export function getDbStats(): {
  mods: number;
  versions: number;
  tags: number;
  presets: number;
} {
  return {
    mods: snapshotState.mods.length,
    versions: snapshotState.modVersions.length,
    tags: snapshotState.tags.length,
    presets: snapshotState.presets.length,
  };
}

export function isReleaseMcVersion(version: string): boolean {
  return /^\d+\.\d+(?:\.\d+)?$/.test(version.trim());
}

export function compareMcVersionsDesc(a: string, b: string): number {
  const aRel = isReleaseMcVersion(a);
  const bRel = isReleaseMcVersion(b);
  if (aRel !== bRel) {
    return aRel ? -1 : 1;
  }

  const parseNums = (v: string): number[] => {
    const match = v.match(/^\d+(?:\.\d+)*/);
    if (!match) return [0];
    return match[0].split('.').map((n) => Number.parseInt(n, 10) || 0);
  };

  const na = parseNums(a);
  const nb = parseNums(b);
  const len = Math.max(na.length, nb.length);
  for (let i = 0; i < len; i++) {
    const va = na[i] ?? 0;
    const vb = nb[i] ?? 0;
    if (va !== vb) return vb - va;
  }
  return b.localeCompare(a);
}

export function getSetting(key: string): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const val = window.localStorage.getItem(`${SETTINGS_PREFIX}${key}`);
      if (val !== null) return val;
    } catch {
      // ignore storage errors
    }
  }
  return memorySettings.get(key) ?? null;
}

export function setSetting(key: string, value: string): void {
  memorySettings.set(key, value);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(`${SETTINGS_PREFIX}${key}`, value);
    } catch {
      // ignore storage errors
    }
  }
}

export function deleteSetting(key: string): void {
  memorySettings.delete(key);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(`${SETTINGS_PREFIX}${key}`);
    } catch {
      // ignore storage errors
    }
  }
}

function loadTagRelationsMaps(): {
  parentsByTag: Map<string, string[]>;
  childrenByTag: Map<string, string[]>;
} {
  const parentsByTag = new Map<string, string[]>();
  const childrenByTag = new Map<string, string[]>();

  for (const r of snapshotState.tagRelations) {
    const parentId = r.parent_tag_id;
    const childId = r.child_tag_id;

    if (!childrenByTag.has(parentId)) childrenByTag.set(parentId, []);
    childrenByTag.get(parentId)!.push(childId);

    if (!parentsByTag.has(childId)) parentsByTag.set(childId, []);
    parentsByTag.get(childId)!.push(parentId);
  }

  return { parentsByTag, childrenByTag };
}

function attachModRelations(rows: ModRow[]): ModRecord[] {
  if (rows.length === 0) return [];

  const modIdSet = new Set(rows.map((r) => r.id));
  const { parentsByTag, childrenByTag } = loadTagRelationsMaps();

  const tagMap = new Map<string, TagRow>();
  for (const t of snapshotState.tags) tagMap.set(t.id, t);

  const tagsByMod = new Map<string, ModTag[]>();
  for (const mt of snapshotState.modTags) {
    if (!modIdSet.has(mt.mod_id)) continue;
    const t = tagMap.get(mt.tag_id);
    if (!t) continue;
    const list = tagsByMod.get(mt.mod_id) ?? [];
    list.push({
      id: t.id,
      name: t.name,
      kind: t.kind,
      color: t.color || '#3b82f6',
      parentIds: parentsByTag.get(t.id) ?? [],
      childIds: childrenByTag.get(t.id) ?? [],
    });
    tagsByMod.set(mt.mod_id, list);
  }

  for (const list of tagsByMod.values()) {
    list.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'custom' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  const loadersByMod = new Map<string, Set<string>>();
  const versionsByMod = new Map<string, Set<string>>();
  const combosByMod = new Map<string, Set<string>>();

  for (const v of snapshotState.modVersions) {
    if (!modIdSet.has(v.mod_id)) continue;
    if (!loadersByMod.has(v.mod_id)) loadersByMod.set(v.mod_id, new Set());
    if (!versionsByMod.has(v.mod_id)) versionsByMod.set(v.mod_id, new Set());
    if (!combosByMod.has(v.mod_id)) combosByMod.set(v.mod_id, new Set());
    loadersByMod.get(v.mod_id)!.add(v.loader);
    versionsByMod.get(v.mod_id)!.add(v.mc_version);
    combosByMod.get(v.mod_id)!.add(`${v.mc_version}::${v.loader}`);
  }

  const modMap = new Map<string, ModRow>();
  for (const m of snapshotState.mods) modMap.set(m.id, m);

  const relRows = snapshotState.modRelations.filter((mr) => modIdSet.has(mr.mod_id));
  const relatedIdSet = new Set(relRows.map((r) => r.related_mod_id));
  const relLoaders = new Map<string, Set<string>>();
  const relVersions = new Map<string, Set<string>>();
  const relCombos = new Map<string, Set<string>>();

  if (relatedIdSet.size > 0) {
    for (const v of snapshotState.modVersions) {
      if (!relatedIdSet.has(v.mod_id)) continue;
      if (!relLoaders.has(v.mod_id)) relLoaders.set(v.mod_id, new Set());
      if (!relVersions.has(v.mod_id)) relVersions.set(v.mod_id, new Set());
      if (!relCombos.has(v.mod_id)) relCombos.set(v.mod_id, new Set());
      relLoaders.get(v.mod_id)!.add(v.loader);
      relVersions.get(v.mod_id)!.add(v.mc_version);
      relCombos.get(v.mod_id)!.add(`${v.mc_version}::${v.loader}`);
    }
  }

  const depsByMod = new Map<string, RelatedModSummary[]>();
  const altsByMod = new Map<string, RelatedModSummary[]>();

  for (const r of relRows) {
    const rm = modMap.get(r.related_mod_id);
    if (!rm) continue;
    const summary: RelatedModSummary = {
      id: rm.id,
      name: rm.name,
      jaName: rm.ja_name ?? '',
      slug: rm.slug,
      iconUrl: rm.icon_url ?? null,
      loaders: Array.from(relLoaders.get(rm.id) ?? []).sort(),
      mcVersions: Array.from(relVersions.get(rm.id) ?? []).sort(compareMcVersionsDesc),
      supportedCombos: Array.from(relCombos.get(rm.id) ?? []),
      modrinthId: rm.modrinth_id ?? null,
      modrinthSlug: rm.modrinth_slug ?? null,
      curseforgeId: rm.curseforge_id ?? null,
      curseforgeSlug: rm.curseforge_slug ?? null,
      relationType: r.relation_type,
      note: r.note ?? '',
    };

    if (r.relation_type === 'dependency') {
      const list = depsByMod.get(r.mod_id) ?? [];
      list.push(summary);
      depsByMod.set(r.mod_id, list);
    } else if (r.relation_type === 'alternative') {
      const list = altsByMod.get(r.mod_id) ?? [];
      list.push(summary);
      altsByMod.set(r.mod_id, list);
    }
  }

  for (const list of depsByMod.values()) {
    list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }
  for (const list of altsByMod.values()) {
    list.sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    jaName: row.ja_name ?? '',
    slug: row.slug,
    summary: row.summary ?? '',
    note: row.note ?? '',
    status: row.status || 'candidate',
    modrinthId: row.modrinth_id ?? null,
    modrinthSlug: row.modrinth_slug ?? null,
    curseforgeId: row.curseforge_id ?? null,
    curseforgeSlug: row.curseforge_slug ?? null,
    iconUrl: row.icon_url ?? null,
    author: row.author ?? null,
    clientSide: row.client_side || 'unknown',
    serverSide: row.server_side || 'unknown',
    downloads: Number(row.downloads ?? 0),
    modUpdatedAt: row.mod_updated_at ?? null,
    createdAt: row.created_at,
    syncedAt: row.synced_at,
    tags: tagsByMod.get(row.id) ?? [],
    loaders: Array.from(loadersByMod.get(row.id) ?? []).sort(),
    mcVersions: Array.from(versionsByMod.get(row.id) ?? []).sort(compareMcVersionsDesc),
    supportedCombos: Array.from(combosByMod.get(row.id) ?? []),
    dependencies: depsByMod.get(row.id) ?? [],
    alternatives: altsByMod.get(row.id) ?? [],
  }));
}

export function listAllTags(): ModTag[] {
  const { parentsByTag, childrenByTag } = loadTagRelationsMaps();
  const countByTag = new Map<string, number>();
  for (const mt of snapshotState.modTags) {
    countByTag.set(mt.tag_id, (countByTag.get(mt.tag_id) ?? 0) + 1);
  }

  return snapshotState.tags
    .map((t) => ({
      id: t.id,
      name: t.name,
      kind: t.kind,
      color: t.color || '#3b82f6',
      modCount: countByTag.get(t.id) ?? 0,
      parentIds: parentsByTag.get(t.id) ?? [],
      childIds: childrenByTag.get(t.id) ?? [],
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'custom' ? -1 : 1;
      if ((b.modCount ?? 0) !== (a.modCount ?? 0)) {
        return (b.modCount ?? 0) - (a.modCount ?? 0);
      }
      return a.name.localeCompare(b.name);
    });
}

export function createOrGetTag(
  name: string,
  kind: 'custom' | 'official' = 'custom',
  color = '#3b82f6'
): ModTag {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error('タグ名が空です');
  }

  const existing = snapshotState.tags.find(
    (t) => t.name === trimmed && t.kind === kind
  );

  if (existing) {
    const { parentsByTag, childrenByTag } = loadTagRelationsMaps();
    return {
      id: existing.id,
      name: existing.name,
      kind: existing.kind,
      color: existing.color,
      parentIds: parentsByTag.get(existing.id) ?? [],
      childIds: childrenByTag.get(existing.id) ?? [],
    };
  }

  const id = randomUuid();
  const now = new Date().toISOString();
  snapshotState.tags.push({ id, name: trimmed, kind, color, created_at: now });
  void schedulePersist();

  return { id, name: trimmed, kind, color, parentIds: [], childIds: [] };
}

export function attachTagToMod(modId: string, tagId: string): void {
  const exists = snapshotState.modTags.some(
    (mt) => mt.mod_id === modId && mt.tag_id === tagId
  );
  if (!exists) {
    snapshotState.modTags.push({ mod_id: modId, tag_id: tagId });
    void schedulePersist();
  }
}

export function detachTagFromMod(modId: string, tagId: string): void {
  const before = snapshotState.modTags.length;
  snapshotState.modTags = snapshotState.modTags.filter(
    (mt) => !(mt.mod_id === modId && mt.tag_id === tagId)
  );
  if (snapshotState.modTags.length !== before) {
    void schedulePersist();
  }
}

export function listAllModIds(): string[] {
  return snapshotState.mods.map((m) => m.id);
}

export function updateTag(
  id: string,
  updates: { name?: string; color?: string }
): ModTag | null {
  const current = snapshotState.tags.find((t) => t.id === id);
  if (!current) return null;

  const nextName = updates.name !== undefined ? updates.name.trim() : current.name;
  const nextColor = updates.color !== undefined ? updates.color : current.color;
  if (!nextName) {
    throw new Error('タグ名は空にできません');
  }

  const duplicate = snapshotState.tags.find(
    (t) => t.id !== id && t.name === nextName && t.kind === current.kind
  );
  if (duplicate) {
    throw new Error(`「${nextName}」というタグはすでに存在します`);
  }

  current.name = nextName;
  current.color = nextColor;
  void schedulePersist();

  const { parentsByTag, childrenByTag } = loadTagRelationsMaps();

  return {
    id,
    name: nextName,
    kind: current.kind,
    color: nextColor,
    parentIds: parentsByTag.get(id) ?? [],
    childIds: childrenByTag.get(id) ?? [],
  };
}

export function getDescendantTagIds(tagId: string): string[] {
  const visited = new Set<string>([tagId]);
  const queue = [tagId];
  while (queue.length > 0) {
    const curr = queue.shift()!;
    for (const rel of snapshotState.tagRelations) {
      if (rel.parent_tag_id === curr && !visited.has(rel.child_tag_id)) {
        visited.add(rel.child_tag_id);
        queue.push(rel.child_tag_id);
      }
    }
  }
  return Array.from(visited);
}

export function addTagRelation(parentTagId: string, childTagId: string): void {
  if (parentTagId === childTagId) {
    throw new Error('自分自身を親タグまたは子タグにはできません');
  }

  const parentExists = snapshotState.tags.some((t) => t.id === parentTagId);
  const childExists = snapshotState.tags.some((t) => t.id === childTagId);
  if (!parentExists || !childExists) {
    throw new Error('指定されたタグが見つかりません');
  }

  const descendantsOfChild = getDescendantTagIds(childTagId);
  if (descendantsOfChild.includes(parentTagId)) {
    throw new Error(
      '循環参照（ループ）が発生するため、この親子関係は登録できません'
    );
  }

  const exists = snapshotState.tagRelations.some(
    (r) => r.parent_tag_id === parentTagId && r.child_tag_id === childTagId
  );
  if (!exists) {
    snapshotState.tagRelations.push({
      parent_tag_id: parentTagId,
      child_tag_id: childTagId,
    });
    void schedulePersist();
  }
}

export function removeTagRelation(parentTagId: string, childTagId: string): boolean {
  const before = snapshotState.tagRelations.length;
  snapshotState.tagRelations = snapshotState.tagRelations.filter(
    (r) => !(r.parent_tag_id === parentTagId && r.child_tag_id === childTagId)
  );
  const changed = snapshotState.tagRelations.length !== before;
  if (changed) void schedulePersist();
  return changed;
}

export function deleteTag(id: string): boolean {
  const before = snapshotState.tags.length;
  snapshotState.tags = snapshotState.tags.filter((t) => t.id !== id);
  if (snapshotState.tags.length === before) return false;

  snapshotState.modTags = snapshotState.modTags.filter((mt) => mt.tag_id !== id);
  snapshotState.tagRelations = snapshotState.tagRelations.filter(
    (tr) => tr.parent_tag_id !== id && tr.child_tag_id !== id
  );
  void schedulePersist();
  return true;
}

export function getModById(id: string): ModRecord | null {
  const row = snapshotState.mods.find((m) => m.id === id);
  if (!row) return null;

  const [mod] = attachModRelations([row]);
  const versions: ModVersionEntry[] = snapshotState.modVersions
    .filter((v) => v.mod_id === id)
    .map((v) => ({
      id: v.id,
      modId: v.mod_id,
      source: v.source,
      mcVersion: v.mc_version,
      loader: v.loader,
      versionNumber: v.version_number,
      releaseType: v.release_type || 'release',
      publishedAt: v.published_at ?? null,
    }))
    .sort((a, b) => compareMcVersionsDesc(a.mcVersion, b.mcVersion));

  return {
    ...mod,
    versions,
  };
}

export function updateModMetadata(
  id: string,
  updates: {
    jaName?: string;
    note?: string;
    status?: ModStatus;
    tagIds?: string[];
  }
): ModRecord | null {
  const mod = snapshotState.mods.find((m) => m.id === id);
  if (!mod) return null;

  if (updates.jaName !== undefined) mod.ja_name = updates.jaName;
  if (updates.note !== undefined) mod.note = updates.note;
  if (updates.status !== undefined) mod.status = updates.status;
  if (updates.tagIds !== undefined) {
    snapshotState.modTags = snapshotState.modTags.filter((mt) => mt.mod_id !== id);
    const seen = new Set<string>();
    for (const tagId of updates.tagIds) {
      if (!seen.has(tagId)) {
        seen.add(tagId);
        snapshotState.modTags.push({ mod_id: id, tag_id: tagId });
      }
    }
  }

  void schedulePersist();
  return getModById(id);
}

export function deleteMod(id: string): boolean {
  const before = snapshotState.mods.length;
  snapshotState.mods = snapshotState.mods.filter((m) => m.id !== id);
  if (snapshotState.mods.length === before) return false;

  snapshotState.modVersions = snapshotState.modVersions.filter((v) => v.mod_id !== id);
  snapshotState.modTags = snapshotState.modTags.filter((mt) => mt.mod_id !== id);
  snapshotState.modRelations = snapshotState.modRelations.filter(
    (mr) => mr.mod_id !== id && mr.related_mod_id !== id
  );
  snapshotState.presetItems = snapshotState.presetItems.filter((pi) => pi.mod_id !== id);
  void schedulePersist();
  return true;
}

export function upsertExternalPayloadToStore(
  payload: ExternalModPayloadInput,
  options: { initialTagIds?: string[]; mergeIntoModId?: string } = {}
): { mod: ModRecord; action: 'created' | 'updated' | 'merged' } {
  const now = new Date().toISOString();

  let targetRow: ModRow | undefined;
  let action: 'created' | 'updated' | 'merged' = 'created';

  if (options.mergeIntoModId) {
    targetRow = snapshotState.mods.find((m) => m.id === options.mergeIntoModId);
    if (!targetRow) {
      throw new Error('結合先のMODが見つかりませんでした');
    }
    action = 'merged';
  } else if (payload.source === 'modrinth') {
    targetRow = snapshotState.mods.find((m) => m.modrinth_id === payload.externalId);
    if (targetRow) action = 'updated';
  } else {
    targetRow = snapshotState.mods.find((m) => m.curseforge_id === payload.externalId);
    if (targetRow) action = 'updated';
  }

  if (!targetRow) {
    const normalizedName = payload.name.replace(/\s+/g, '').toLowerCase();
    const candidate = snapshotState.mods.find(
      (m) =>
        m.slug.toLowerCase() === payload.slug.toLowerCase() ||
        m.name.replace(/\s+/g, '').toLowerCase() === normalizedName
    );

    if (candidate) {
      const sameSourceOccupied =
        (payload.source === 'modrinth' && candidate.modrinth_id) ||
        (payload.source === 'curseforge' && candidate.curseforge_id);
      if (!sameSourceOccupied) {
        targetRow = candidate;
        action = 'merged';
      }
    }
  }

  let modId: string;

  if (targetRow) {
    modId = targetRow.id;
    targetRow.name = targetRow.name || payload.name;
    targetRow.summary = targetRow.summary === '' ? payload.summary : targetRow.summary;
    if (payload.source === 'modrinth') {
      targetRow.modrinth_id = payload.externalId;
      targetRow.modrinth_slug = payload.slug;
    } else {
      targetRow.curseforge_id = payload.externalId;
      targetRow.curseforge_slug = payload.slug;
    }
    targetRow.icon_url = targetRow.icon_url ?? payload.iconUrl;
    targetRow.author = targetRow.author ?? payload.author;
    if (payload.clientSide !== 'unknown') {
      targetRow.client_side = payload.clientSide;
    }
    if (payload.serverSide !== 'unknown') {
      targetRow.server_side = payload.serverSide;
    }
    targetRow.downloads = Math.max(Number(targetRow.downloads ?? 0), payload.downloads);
    if (payload.updatedAt && (!targetRow.mod_updated_at || payload.updatedAt > targetRow.mod_updated_at)) {
      targetRow.mod_updated_at = payload.updatedAt;
    }
    targetRow.synced_at = now;
  } else {
    modId = randomUuid();
    snapshotState.mods.push({
      id: modId,
      name: payload.name,
      ja_name: '',
      slug: payload.slug,
      summary: payload.summary,
      note: '',
      status: 'candidate',
      modrinth_id: payload.source === 'modrinth' ? payload.externalId : null,
      modrinth_slug: payload.source === 'modrinth' ? payload.slug : null,
      curseforge_id: payload.source === 'curseforge' ? payload.externalId : null,
      curseforge_slug: payload.source === 'curseforge' ? payload.slug : null,
      icon_url: payload.iconUrl,
      author: payload.author,
      client_side: payload.clientSide,
      server_side: payload.serverSide,
      downloads: payload.downloads,
      mod_updated_at: payload.updatedAt,
      created_at: now,
      synced_at: now,
    });
  }

  snapshotState.modVersions = snapshotState.modVersions.filter(
    (v) => !(v.mod_id === modId && v.source === payload.source)
  );
  for (const v of payload.versions) {
    snapshotState.modVersions.push({
      id: randomUuid(),
      mod_id: modId,
      source: payload.source,
      mc_version: v.mcVersion,
      loader: v.loader,
      version_number: v.versionNumber,
      release_type: v.releaseType,
      published_at: v.publishedAt,
    });
  }

  for (const cat of payload.categories) {
    const tag = createOrGetTag(cat, 'official', '#475569');
    attachTagToMod(modId, tag.id);
  }
  for (const tagId of options.initialTagIds ?? []) {
    attachTagToMod(modId, tagId);
  }

  void schedulePersist();

  const saved = getModById(modId);
  if (!saved) {
    throw new Error('MODの保存後の読み込みに失敗しました');
  }
  return { mod: saved, action };
}

export function searchLocalMods(params: ModSearchParams = {}): ModSearchResponse {
  const qLower = params.q?.trim().toLowerCase() ?? '';
  const mcVersions = new Set((params.mcVersions ?? []).filter(Boolean));
  const loaders = new Set((params.loaders ?? []).filter(Boolean));
  const expandMeta = params.expandMetaTags !== false;
  const andTags = (params.andTags ?? []).filter(Boolean);
  const orTags = (params.orTags ?? []).filter(Boolean);
  const notTags = (params.notTags ?? []).filter(Boolean);

  const andTargetSets = andTags.map(
    (id) => new Set(expandMeta ? getDescendantTagIds(id) : [id])
  );

  const orTargetSet = new Set<string>();
  for (const id of orTags) {
    for (const d of expandMeta ? getDescendantTagIds(id) : [id]) {
      orTargetSet.add(d);
    }
  }

  const notTargetSet = new Set<string>();
  for (const id of notTags) {
    for (const d of expandMeta ? getDescendantTagIds(id) : [id]) {
      notTargetSet.add(d);
    }
  }

  const versionsByMod = new Map<string, ModVersionRow[]>();
  for (const v of snapshotState.modVersions) {
    const list = versionsByMod.get(v.mod_id) ?? [];
    list.push(v);
    versionsByMod.set(v.mod_id, list);
  }

  const tagIdsByMod = new Map<string, Set<string>>();
  for (const mt of snapshotState.modTags) {
    if (!tagIdsByMod.has(mt.mod_id)) tagIdsByMod.set(mt.mod_id, new Set());
    tagIdsByMod.get(mt.mod_id)!.add(mt.tag_id);
  }

  const filtered = snapshotState.mods.filter((m) => {
    if (qLower) {
      const hit =
        m.name.toLowerCase().includes(qLower) ||
        m.ja_name.toLowerCase().includes(qLower) ||
        m.slug.toLowerCase().includes(qLower) ||
        m.summary.toLowerCase().includes(qLower) ||
        m.note.toLowerCase().includes(qLower) ||
        (m.author ?? '').toLowerCase().includes(qLower);
      if (!hit) return false;
    }

    if (mcVersions.size > 0 || loaders.size > 0) {
      const mVers = versionsByMod.get(m.id) ?? [];
      const verMatch = mVers.some((v) => {
        if (mcVersions.size > 0 && !mcVersions.has(v.mc_version)) return false;
        if (loaders.size > 0 && !loaders.has(v.loader)) return false;
        return true;
      });
      if (!verMatch) return false;
    }

    const mTags = tagIdsByMod.get(m.id) ?? new Set<string>();

    for (const targetSet of andTargetSets) {
      let hasOne = false;
      for (const tid of targetSet) {
        if (mTags.has(tid)) {
          hasOne = true;
          break;
        }
      }
      if (!hasOne) return false;
    }

    if (orTargetSet.size > 0) {
      let hasOne = false;
      for (const tid of orTargetSet) {
        if (mTags.has(tid)) {
          hasOne = true;
          break;
        }
      }
      if (!hasOne) return false;
    }

    if (notTargetSet.size > 0) {
      for (const tid of notTargetSet) {
        if (mTags.has(tid)) return false;
      }
    }

    if (params.status && params.status !== 'all' && m.status !== params.status) {
      return false;
    }
    if (
      params.clientSide &&
      params.clientSide !== 'all' &&
      m.client_side !== params.clientSide
    ) {
      return false;
    }
    if (
      params.serverSide &&
      params.serverSide !== 'all' &&
      m.server_side !== params.serverSide
    ) {
      return false;
    }

    return true;
  });

  filtered.sort((a, b) => {
    switch (params.sort) {
      case 'downloads_desc':
        if (b.downloads !== a.downloads) return b.downloads - a.downloads;
        return a.name.localeCompare(b.name);
      case 'name_asc':
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
      case 'created_desc':
        return b.created_at.localeCompare(a.created_at);
      case 'updated_desc':
      default: {
        const da = a.mod_updated_at || a.synced_at;
        const dbDate = b.mod_updated_at || b.synced_at;
        if (dbDate !== da) return dbDate.localeCompare(da);
        return b.downloads - a.downloads;
      }
    }
  });

  const mods = attachModRelations(filtered);

  const mcSet = new Set<string>();
  const loaderSet = new Set<string>();
  for (const v of snapshotState.modVersions) {
    if (v.mc_version) mcSet.add(v.mc_version);
    if (v.loader) loaderSet.add(v.loader);
  }

  return {
    mods,
    totalCount: snapshotState.mods.length,
    facets: {
      mcVersions: Array.from(mcSet).sort(compareMcVersionsDesc),
      loaders: Array.from(loaderSet).sort(),
      tags: listAllTags(),
    },
  };
}

export function getExistingExternalIdMaps(): {
  byModrinthId: Map<string, string>;
  byCurseforgeId: Map<string, string>;
  bySlug: Map<string, string>;
  byNormalizedName: Map<string, string>;
} {
  const byModrinthId = new Map<string, string>();
  const byCurseforgeId = new Map<string, string>();
  const bySlug = new Map<string, string>();
  const byNormalizedName = new Map<string, string>();

  for (const r of snapshotState.mods) {
    if (r.modrinth_id) byModrinthId.set(r.modrinth_id, r.id);
    if (r.curseforge_id) byCurseforgeId.set(r.curseforge_id, r.id);
    if (r.slug) bySlug.set(r.slug.toLowerCase(), r.id);
    if (r.modrinth_slug) bySlug.set(r.modrinth_slug.toLowerCase(), r.id);
    if (r.curseforge_slug) bySlug.set(r.curseforge_slug.toLowerCase(), r.id);
    if (r.name) {
      const normalized = r.name.replace(/\s+/g, '').toLowerCase();
      if (normalized) byNormalizedName.set(normalized, r.id);
    }
  }

  return { byModrinthId, byCurseforgeId, bySlug, byNormalizedName };
}

export function addModRelation(
  modId: string,
  relatedModId: string,
  relationType: ModRelationType,
  note = ''
): void {
  if (modId === relatedModId) {
    throw new Error('自分自身を関連MODに設定することはできません');
  }

  const m1 = snapshotState.mods.some((m) => m.id === modId);
  const m2 = snapshotState.mods.some((m) => m.id === relatedModId);
  if (!m1 || !m2) {
    throw new Error('指定されたMODがデータベースに存在しません');
  }

  const now = new Date().toISOString();
  const upsertRel = (srcId: string, dstId: string) => {
    const existing = snapshotState.modRelations.find(
      (r) =>
        r.mod_id === srcId &&
        r.related_mod_id === dstId &&
        r.relation_type === relationType
    );
    if (existing) {
      existing.note = note;
      existing.created_at = now;
    } else {
      snapshotState.modRelations.push({
        mod_id: srcId,
        related_mod_id: dstId,
        relation_type: relationType,
        note,
        created_at: now,
      });
    }
  };

  upsertRel(modId, relatedModId);
  if (relationType === 'alternative') {
    upsertRel(relatedModId, modId);
  }
  void schedulePersist();
}

export function removeModRelation(
  modId: string,
  relatedModId: string,
  relationType: ModRelationType
): boolean {
  const before = snapshotState.modRelations.length;
  snapshotState.modRelations = snapshotState.modRelations.filter((r) => {
    if (
      r.mod_id === modId &&
      r.related_mod_id === relatedModId &&
      r.relation_type === relationType
    ) {
      return false;
    }
    if (
      relationType === 'alternative' &&
      r.mod_id === relatedModId &&
      r.related_mod_id === modId &&
      r.relation_type === relationType
    ) {
      return false;
    }
    return true;
  });

  const changed = snapshotState.modRelations.length !== before;
  if (changed) void schedulePersist();
  return changed;
}

function hydratePresets(presetRows: PresetRow[]): ModPreset[] {
  if (presetRows.length === 0) return [];

  const presetIdSet = new Set(presetRows.map((p) => p.id));
  const modRowMap = new Map<string, ModRow>();
  for (const m of snapshotState.mods) modRowMap.set(m.id, m);

  const relevantItems = snapshotState.presetItems.filter(
    (pi) => presetIdSet.has(pi.preset_id) && modRowMap.has(pi.mod_id)
  );

  const uniqueMods: ModRow[] = [];
  const seenModIds = new Set<string>();
  for (const pi of relevantItems) {
    if (!seenModIds.has(pi.mod_id)) {
      seenModIds.add(pi.mod_id);
      const mr = modRowMap.get(pi.mod_id);
      if (mr) uniqueMods.push(mr);
    }
  }

  const hydratedMods = attachModRelations(uniqueMods);
  const modMap = new Map<string, ModRecord>();
  for (const m of hydratedMods) modMap.set(m.id, m);

  const itemsByPreset = new Map<string, PresetModItem[]>();
  for (const pi of relevantItems) {
    const mod = modMap.get(pi.mod_id);
    if (!mod) continue;
    const list = itemsByPreset.get(pi.preset_id) ?? [];
    list.push({
      presetId: pi.preset_id,
      modId: pi.mod_id,
      requirement: pi.requirement || 'required',
      note: pi.note ?? '',
      sortOrder: Number(pi.sort_order ?? 0),
      mod,
    });
    itemsByPreset.set(pi.preset_id, list);
  }

  for (const list of itemsByPreset.values()) {
    list.sort((a, b) => {
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
      const ra = a.requirement === 'required' ? 0 : 1;
      const rb = b.requirement === 'required' ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return a.mod.name.toLowerCase().localeCompare(b.mod.name.toLowerCase());
    });
  }

  return presetRows.map((p) => ({
    id: p.id,
    name: p.name,
    description: p.description ?? '',
    color: p.color ?? '#10b981',
    createdAt: p.created_at,
    updatedAt: p.updated_at,
    items: itemsByPreset.get(p.id) ?? [],
  }));
}

export function listPresets(): ModPreset[] {
  const rows = [...snapshotState.presets].sort((a, b) => {
    if (b.updated_at !== a.updated_at) return b.updated_at.localeCompare(a.updated_at);
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
  return hydratePresets(rows);
}

export function getPresetById(id: string): ModPreset | null {
  const row = snapshotState.presets.find((p) => p.id === id);
  if (!row) return null;
  const [preset] = hydratePresets([row]);
  return preset ?? null;
}

export function createPreset(input: {
  name: string;
  description?: string;
  color?: string;
}): ModPreset {
  const name = input.name.trim();
  if (!name) {
    throw new Error('プリセット名を入力してください');
  }
  const id = randomUuid();
  const now = new Date().toISOString();
  snapshotState.presets.push({
    id,
    name,
    description: input.description?.trim() ?? '',
    color: input.color ?? '#10b981',
    created_at: now,
    updated_at: now,
  });
  void schedulePersist();

  return getPresetById(id)!;
}

export function updatePreset(
  id: string,
  updates: { name?: string; description?: string; color?: string }
): ModPreset | null {
  const current = snapshotState.presets.find((p) => p.id === id);
  if (!current) return null;

  const name = updates.name !== undefined ? updates.name.trim() : current.name;
  if (!name) {
    throw new Error('プリセット名は空にできません');
  }
  current.name = name;
  if (updates.description !== undefined) {
    current.description = updates.description.trim();
  }
  if (updates.color !== undefined) {
    current.color = updates.color;
  }
  current.updated_at = new Date().toISOString();
  void schedulePersist();

  return getPresetById(id);
}

export function deletePreset(id: string): boolean {
  const before = snapshotState.presets.length;
  snapshotState.presets = snapshotState.presets.filter((p) => p.id !== id);
  if (snapshotState.presets.length === before) return false;

  snapshotState.presetItems = snapshotState.presetItems.filter(
    (pi) => pi.preset_id !== id
  );
  void schedulePersist();
  return true;
}

export function upsertPresetItem(
  presetId: string,
  item: {
    modId: string;
    requirement?: PresetRequirement;
    note?: string;
  }
): ModPreset | null {
  const preset = snapshotState.presets.find((p) => p.id === presetId);
  if (!preset) return null;

  const modExists = snapshotState.mods.some((m) => m.id === item.modId);
  if (!modExists) {
    throw new Error('対象のMODが見つかりません');
  }

  const existing = snapshotState.presetItems.find(
    (pi) => pi.preset_id === presetId && pi.mod_id === item.modId
  );

  if (existing) {
    if (item.requirement !== undefined) existing.requirement = item.requirement;
    if (item.note !== undefined) existing.note = item.note;
  } else {
    const maxOrder = snapshotState.presetItems
      .filter((pi) => pi.preset_id === presetId)
      .reduce((max, pi) => Math.max(max, pi.sort_order), -1);
    snapshotState.presetItems.push({
      preset_id: presetId,
      mod_id: item.modId,
      requirement: item.requirement ?? 'required',
      note: item.note ?? '',
      sort_order: maxOrder + 1,
    });
  }

  preset.updated_at = new Date().toISOString();
  void schedulePersist();

  return getPresetById(presetId);
}

export function removePresetItem(presetId: string, modId: string): ModPreset | null {
  const preset = snapshotState.presets.find((p) => p.id === presetId);
  if (!preset) return null;

  snapshotState.presetItems = snapshotState.presetItems.filter(
    (pi) => !(pi.preset_id === presetId && pi.mod_id === modId)
  );
  preset.updated_at = new Date().toISOString();
  void schedulePersist();

  return getPresetById(presetId);
}
