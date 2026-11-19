import { getModById } from '@/lib/db';
import type { ModRecord } from '@/types/mod';

const USER_AGENT = 'mc-mod-db/1.0.0 (local-personal-tool)';

export interface ZipEntryInput {
  path: string;
  data: Uint8Array;
}

export interface MrpackIndexFile {
  path: string;
  hashes: {
    sha1: string;
    sha512: string;
  };
  env: {
    client: 'required' | 'optional' | 'unsupported';
    server: 'required' | 'optional' | 'unsupported';
  };
  downloads: string[];
  fileSize: number;
}

export interface MrpackIndexJson {
  formatVersion: 1;
  game: 'minecraft';
  versionId: string;
  name: string;
  summary: string;
  dependencies: Record<string, string>;
  files: MrpackIndexFile[];
}

export interface SkippedMrpackMod {
  id: string;
  name: string;
  reason: string;
}

export interface MrpackArchiveResult {
  filename: string;
  base64: string;
  includedCount: number;
  skippedMods: SkippedMrpackMod[];
  indexJson: MrpackIndexJson;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function deflateRawBytes(
  data: Uint8Array
): Promise<{ payload: Uint8Array; method: 0 | 8 }> {
  if (typeof CompressionStream === 'undefined' || data.byteLength < 32) {
    return { payload: data, method: 0 };
  }
  try {
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    const cs = new CompressionStream('deflate-raw');
    const writer = cs.writable.getWriter();
    void writer.write(copy).then(() => writer.close());
    const buf = await new Response(cs.readable).arrayBuffer();
    const compressed = new Uint8Array(buf);
    if (compressed.byteLength >= data.byteLength) {
      return { payload: data, method: 0 };
    }
    return { payload: compressed, method: 8 };
  } catch {
    return { payload: data, method: 0 };
  }
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const sub = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...sub);
  }
  return btoa(binary);
}

/**
 * Pure Web API (`CompressionStream` + `DataView`) を使った標準 ZIP アーカイブ生成
 */
export async function createZipBytes(entries: ZipEntryInput[]): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(now.getFullYear(), 1980) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const cleanPath = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = encoder.encode(cleanPath);
    const rawData = entry.data;
    const { payload, method } = await deflateRawBytes(rawData);
    const crc = computeCrc32(rawData);

    const localHeader = new Uint8Array(30);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, method, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.byteLength, true);
    lv.setUint32(22, rawData.byteLength, true);
    lv.setUint16(26, nameBuf.byteLength, true);
    lv.setUint16(28, 0, true);

    localParts.push(localHeader, nameBuf, payload);

    const cdHeader = new Uint8Array(46);
    const cv = new DataView(cdHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, method, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.byteLength, true);
    cv.setUint32(24, rawData.byteLength, true);
    cv.setUint16(28, nameBuf.byteLength, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);

    centralParts.push(cdHeader, nameBuf);
    offset += localHeader.byteLength + nameBuf.byteLength + payload.byteLength;
  }

  const centralDirBuffer = concatUint8Arrays(centralParts);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirBuffer.byteLength, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return concatUint8Arrays([...localParts, centralDirBuffer, eocd]);
}

async function fetchJsonWithTimeout<T>(url: string): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (typeof window === 'undefined') {
    headers['User-Agent'] = USER_AGENT;
  }

  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(8000),
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} (${url})`);
  }
  return (await res.json()) as T;
}

async function resolveLoaderDependency(
  mcVersion: string,
  loader: string
): Promise<Record<string, string>> {
  const normalized = loader.trim().toLowerCase();
  const deps: Record<string, string> = { minecraft: mcVersion };

  if (normalized === 'fabric') {
    let loaderVer = '0.16.10';
    try {
      const list = await fetchJsonWithTimeout<
        Array<{ version: string; stable?: boolean }>
      >('https://meta.fabricmc.net/v2/versions/loader');
      const preferred = list.find((item) => item.stable) ?? list[0];
      if (preferred?.version) loaderVer = preferred.version;
    } catch {
      // Fallback version
    }
    deps['fabric-loader'] = loaderVer;
  } else if (normalized === 'quilt') {
    let loaderVer = '0.26.4';
    try {
      const list = await fetchJsonWithTimeout<Array<{ version: string }>>(
        'https://meta.quiltmc.org/v3/versions/loader'
      );
      if (list[0]?.version) loaderVer = list[0].version;
    } catch {
      // Fallback version
    }
    deps['quilt-loader'] = loaderVer;
  } else if (normalized === 'neoforge') {
    let loaderVer = '21.1.77';
    try {
      const res = await fetchJsonWithTimeout<{ versions?: string[] }>(
        'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
      );
      const prefix = `${mcVersion.replace(/^1\./, '')}.`;
      const matched = (res.versions ?? []).filter((v) => v.startsWith(prefix));
      if (matched.length > 0) {
        loaderVer = matched[matched.length - 1];
      }
    } catch {
      // Fallback version
    }
    deps['neoforge'] = loaderVer;
  } else if (normalized === 'forge') {
    let loaderVer = '47.3.0';
    try {
      const res = await fetchJsonWithTimeout<{
        promos?: Record<string, string>;
      }>(
        'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
      );
      const candidate =
        res.promos?.[`${mcVersion}-recommended`] ??
        res.promos?.[`${mcVersion}-latest`];
      if (candidate) loaderVer = candidate;
    } catch {
      // Fallback version
    }
    deps['forge'] = loaderVer;
  }

  return deps;
}

function mapSideEnv(
  side: ModRecord['clientSide']
): 'required' | 'optional' | 'unsupported' {
  if (side === 'optional' || side === 'unsupported' || side === 'required') {
    return side;
  }
  return 'required';
}

interface ModrinthVersionFile {
  hashes?: { sha1?: string; sha512?: string };
  url?: string;
  filename?: string;
  primary?: boolean;
  size?: number;
}

interface ModrinthFilteredVersion {
  version_type?: string;
  date_published?: string;
  files?: ModrinthVersionFile[];
}

function collectModsWithDependencies(
  modIds: string[],
  includeDependencies: boolean
): ModRecord[] {
  const collected = new Map<string, ModRecord>();
  const visitedDeps = new Set<string>();

  function visitMod(id: string, depthRemaining: number) {
    const mod = getModById(id);
    if (!mod) return;
    if (!collected.has(mod.id)) {
      collected.set(mod.id, mod);
    }
    if (!includeDependencies || depthRemaining <= 0 || visitedDeps.has(mod.id)) {
      return;
    }
    visitedDeps.add(mod.id);
    for (const dep of mod.dependencies) {
      visitMod(dep.id, depthRemaining - 1);
    }
  }

  for (const id of modIds) {
    visitMod(id, 2);
  }

  return Array.from(collected.values());
}

/**
 * 指定条件 (mcVersion × loader) に対する Modrinth .mrpack アーカイブを生成します。
 */
export async function buildMrpackArchive(params: {
  name?: string;
  summary?: string;
  mcVersion: string;
  loader: string;
  modIds: string[];
  includeDependencies?: boolean;
}): Promise<MrpackArchiveResult> {
  const mcVersion = params.mcVersion.trim();
  const loader = params.loader.trim().toLowerCase();
  const includeDependencies = params.includeDependencies !== false;

  const mods = collectModsWithDependencies(params.modIds, includeDependencies);
  if (mods.length === 0) {
    throw new Error('対象MODが見つかりませんでした');
  }

  const dependencies = await resolveLoaderDependency(mcVersion, loader);
  const files: MrpackIndexFile[] = [];
  const skippedMods: SkippedMrpackMod[] = [];
  const usedPaths = new Set<string>();

  for (const mod of mods) {
    if (!mod.modrinthId) {
      skippedMods.push({
        id: mod.id,
        name: mod.name,
        reason: 'Modrinth ID 未登録（CurseForge専用または手動登録）',
      });
      continue;
    }

    try {
      const loadersParam = encodeURIComponent(JSON.stringify([loader]));
      const gameVersionsParam = encodeURIComponent(JSON.stringify([mcVersion]));
      const versions = await fetchJsonWithTimeout<ModrinthFilteredVersion[]>(
        `https://api.modrinth.com/v2/project/${encodeURIComponent(mod.modrinthId)}/version?loaders=${loadersParam}&game_versions=${gameVersionsParam}`
      );

      const candidates = versions
        .filter((v) =>
          (v.files ?? []).some(
            (f) => f.url && f.hashes?.sha1 && f.hashes?.sha512 && f.filename
          )
        )
        .sort((a, b) => {
          const aRel = a.version_type === 'release' ? 0 : 1;
          const bRel = b.version_type === 'release' ? 0 : 1;
          if (aRel !== bRel) return aRel - bRel;
          return (b.date_published ?? '').localeCompare(a.date_published ?? '');
        });

      const chosenVersion = candidates[0];
      const validFiles = (chosenVersion?.files ?? []).filter(
        (f) => f.url && f.hashes?.sha1 && f.hashes?.sha512 && f.filename
      );
      const chosenFile = validFiles.find((f) => f.primary) ?? validFiles[0];

      if (
        !chosenFile?.url ||
        !chosenFile.hashes?.sha1 ||
        !chosenFile.hashes?.sha512 ||
        !chosenFile.filename
      ) {
        skippedMods.push({
          id: mod.id,
          name: mod.name,
          reason: `${mcVersion} / ${loader} に対応するModrinthファイルが見つかりません`,
        });
        continue;
      }

      const safeFileName = chosenFile.filename.replace(/[\\/:*?"<>|]/g, '_');
      let entryPath = `mods/${safeFileName}`;
      if (usedPaths.has(entryPath)) {
        entryPath = `mods/${mod.modrinthSlug || mod.id}-${safeFileName}`;
      }
      usedPaths.add(entryPath);

      files.push({
        path: entryPath,
        hashes: {
          sha1: chosenFile.hashes.sha1,
          sha512: chosenFile.hashes.sha512,
        },
        env: {
          client: mapSideEnv(mod.clientSide),
          server: mapSideEnv(mod.serverSide),
        },
        downloads: [chosenFile.url],
        fileSize: chosenFile.size ?? 0,
      });
    } catch (err) {
      skippedMods.push({
        id: mod.id,
        name: mod.name,
        reason: err instanceof Error ? err.message : 'Modrinth API取得エラー',
      });
    }
  }

  const packName = (params.name?.trim() || 'MC MOD Preset').slice(0, 80);
  const indexJson: MrpackIndexJson = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0.0',
    name: packName,
    summary:
      params.summary?.trim() ||
      `Generated by MC MOD DB (${mcVersion} / ${loader})`,
    dependencies,
    files,
  };

  const encoder = new TextEncoder();
  const zipEntries: ZipEntryInput[] = [
    {
      path: 'modrinth.index.json',
      data: encoder.encode(JSON.stringify(indexJson, null, 2)),
    },
  ];

  if (skippedMods.length > 0) {
    const readmeLines = [
      `# ${packName} (${mcVersion} / ${loader})`,
      '# 以下のMODは自動ダウンロードURL (Modrinth) が見つからないため .mrpack に含まれませんでした。',
      '# 必要に応じて手動で mods/ フォルダに追加してください。',
      '',
      ...skippedMods.map((m) => `- ${m.name}: ${m.reason}`),
      '',
    ];
    zipEntries.push({
      path: 'overrides/README-SKIPPED-MODS.txt',
      data: encoder.encode(readmeLines.join('\n')),
    });
  }

  const zipBytes = await createZipBytes(zipEntries);
  const safeSlug =
    packName
      .replace(/[<>:"/\\|?*\x00-\x1f]/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'modpack';

  return {
    filename: `${safeSlug}-${mcVersion}-${loader}.mrpack`,
    base64: uint8ArrayToBase64(zipBytes),
    includedCount: files.length,
    skippedMods,
    indexJson,
  };
}

export interface ParsedModpackEntry {
  source: 'modrinth' | 'curseforge';
  idOrSlug: string;
  required: boolean;
  label: string;
}

export interface ParsedModpackResult {
  format: 'mrpack' | 'curseforge-manifest';
  name: string;
  summary: string;
  mcVersion: string | null;
  loader: string | null;
  entries: ParsedModpackEntry[];
  unresolvedCount: number;
}

async function inflateRawBytes(
  data: Uint8Array,
  method: number
): Promise<Uint8Array> {
  if (method === 0) return data;
  if (method !== 8) {
    throw new Error(`未対応のZIP圧縮方式です (method=${method})`);
  }
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('お使いのブラウザは DecompressionStream に対応していません');
  }
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const ds = new DecompressionStream('deflate-raw');
  const writer = ds.writable.getWriter();
  void writer.write(copy).then(() => writer.close());
  const buf = await new Response(ds.readable).arrayBuffer();
  return new Uint8Array(buf);
}

/**
 * Pure Web API (`DataView` + `DecompressionStream`) を使って ZIP / .mrpack から指定ファイルを読み取ります。
 */
export async function extractZipEntryText(
  zipBytes: Uint8Array,
  targetFilenames: string[]
): Promise<{ filename: string; text: string } | null> {
  const view = new DataView(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength);
  const decoder = new TextDecoder('utf-8');
  const targets = new Set(targetFilenames.map((f) => f.toLowerCase()));

  // Locate End of Central Directory (0x06054b50)
  const minEocdOffset = Math.max(0, zipBytes.byteLength - 65557);
  let eocdOffset = -1;
  for (let i = zipBytes.byteLength - 22; i >= minEocdOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('有効な ZIP / .mrpack ファイルではありません');
  }

  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  let cursor = cdOffset;
  const cdEnd = cdOffset + cdSize;

  while (cursor + 46 <= cdEnd && cursor + 46 <= zipBytes.byteLength) {
    if (view.getUint32(cursor, true) !== 0x02014b50) break;
    const method = view.getUint16(cursor + 10, true);
    const compSize = view.getUint32(cursor + 20, true);
    const nameLen = view.getUint16(cursor + 28, true);
    const extraLen = view.getUint16(cursor + 30, true);
    const commentLen = view.getUint16(cursor + 32, true);
    const localHeaderOffset = view.getUint32(cursor + 42, true);

    const entryName = decoder.decode(
      zipBytes.subarray(cursor + 46, cursor + 46 + nameLen)
    );
    cursor += 46 + nameLen + extraLen + commentLen;

    const normalizedName = entryName.replace(/^\.\//, '').toLowerCase();
    if (!targets.has(normalizedName)) continue;

    if (
      localHeaderOffset + 30 > zipBytes.byteLength ||
      view.getUint32(localHeaderOffset, true) !== 0x04034b50
    ) {
      throw new Error(`ZIPローカルヘッダの読み取りに失敗しました: ${entryName}`);
    }
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen;
    const compressedSlice = zipBytes.subarray(dataStart, dataStart + compSize);
    const rawBytes = await inflateRawBytes(compressedSlice, method);
    return {
      filename: normalizedName,
      text: decoder.decode(rawBytes),
    };
  }

  return null;
}

export async function parseModpackBytes(params: {
  filename: string;
  bytes: Uint8Array;
}): Promise<ParsedModpackResult> {
  const lowerName = params.filename.toLowerCase();
  let jsonText: string;

  if (lowerName.endsWith('.json')) {
    jsonText = new TextDecoder('utf-8').decode(params.bytes);
  } else {
    const extracted = await extractZipEntryText(params.bytes, [
      'modrinth.index.json',
      'manifest.json',
    ]);
    if (!extracted) {
      throw new Error(
        '.mrpack / ZIP 内に modrinth.index.json または manifest.json が見つかりませんでした'
      );
    }
    jsonText = extracted.text;
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(jsonText) as Record<string, unknown>;
  } catch {
    throw new Error('モッドパックの JSON 解析に失敗しました');
  }

  // 1. Modrinth modrinth.index.json
  if (
    parsed.game === 'minecraft' &&
    Array.isArray(parsed.files) &&
    typeof parsed.formatVersion === 'number'
  ) {
    const deps = (parsed.dependencies ?? {}) as Record<string, string>;
    const mcVersion = typeof deps.minecraft === 'string' ? deps.minecraft : null;
    let loader: string | null = null;
    if (deps['fabric-loader']) loader = 'fabric';
    else if (deps.neoforge) loader = 'neoforge';
    else if (deps.forge) loader = 'forge';
    else if (deps['quilt-loader']) loader = 'quilt';

    interface MrIndexFileRaw {
      path?: string;
      hashes?: { sha1?: string };
      downloads?: string[];
      env?: { client?: string; server?: string };
    }

    const modFiles = (parsed.files as MrIndexFileRaw[]).filter((f) => {
      const p = (f.path ?? '').toLowerCase();
      return p.startsWith('mods/') || p.endsWith('.jar');
    });

    const entriesMap = new Map<string, ParsedModpackEntry>();
    const pendingHashes: Array<{ sha1: string; label: string; required: boolean }> = [];

    for (const f of modFiles) {
      const label = (f.path ?? '').split('/').pop() || 'mod';
      const required = f.env?.client !== 'optional' || f.env?.server !== 'optional';
      let projectId: string | null = null;

      for (const dl of f.downloads ?? []) {
        const m = dl.match(/cdn\.modrinth\.com\/data\/([a-zA-Z0-9]+)\//);
        if (m?.[1]) {
          projectId = m[1];
          break;
        }
      }

      if (projectId) {
        if (!entriesMap.has(projectId)) {
          entriesMap.set(projectId, {
            source: 'modrinth',
            idOrSlug: projectId,
            required,
            label,
          });
        }
      } else if (f.hashes?.sha1) {
        pendingHashes.push({
          sha1: f.hashes.sha1.toLowerCase(),
          label,
          required,
        });
      }
    }

    let unresolvedCount = 0;
    for (let i = 0; i < pendingHashes.length; i += 100) {
      const chunk = pendingHashes.slice(i, i + 100);
      try {
        const res = await fetch('https://api.modrinth.com/v2/version_files', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': USER_AGENT,
          },
          body: JSON.stringify({
            hashes: chunk.map((c) => c.sha1),
            algorithm: 'sha1',
          }),
          cache: 'no-store',
        });
        if (res.ok) {
          const map = (await res.json()) as Record<
            string,
            { project_id?: string }
          >;
          for (const item of chunk) {
            const ver = map[item.sha1];
            if (ver?.project_id) {
              if (!entriesMap.has(ver.project_id)) {
                entriesMap.set(ver.project_id, {
                  source: 'modrinth',
                  idOrSlug: ver.project_id,
                  required: item.required,
                  label: item.label,
                });
              }
            } else {
              unresolvedCount += 1;
            }
          }
        } else {
          unresolvedCount += chunk.length;
        }
      } catch {
        unresolvedCount += chunk.length;
      }
    }

    return {
      format: 'mrpack',
      name:
        (typeof parsed.name === 'string' && parsed.name.trim()) ||
        params.filename.replace(/\.(mrpack|zip|json)$/i, ''),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
      mcVersion,
      loader,
      entries: Array.from(entriesMap.values()),
      unresolvedCount,
    };
  }

  // 2. CurseForge manifest.json
  if (Array.isArray(parsed.files)) {
    const mcObj = (parsed.minecraft ?? {}) as {
      version?: string;
      modLoaders?: Array<{ id?: string }>;
    };
    const mcVersion = typeof mcObj.version === 'string' ? mcObj.version : null;
    const rawLoader = mcObj.modLoaders?.[0]?.id?.toLowerCase() ?? '';
    let loader: string | null = null;
    if (rawLoader.startsWith('fabric')) loader = 'fabric';
    else if (rawLoader.startsWith('neoforge')) loader = 'neoforge';
    else if (rawLoader.startsWith('forge')) loader = 'forge';
    else if (rawLoader.startsWith('quilt')) loader = 'quilt';

    interface CfManifestFile {
      projectID?: number;
      fileID?: number;
      required?: boolean;
    }

    const entriesMap = new Map<string, ParsedModpackEntry>();
    for (const f of parsed.files as CfManifestFile[]) {
      if (typeof f.projectID === 'number' && f.projectID > 0) {
        const pid = String(f.projectID);
        if (!entriesMap.has(pid)) {
          entriesMap.set(pid, {
            source: 'curseforge',
            idOrSlug: pid,
            required: f.required !== false,
            label: `CurseForge #${pid}`,
          });
        }
      }
    }

    if (entriesMap.size === 0) {
      throw new Error('モッドパック内に有効なMODエントリが見つかりませんでした');
    }

    return {
      format: 'curseforge-manifest',
      name:
        (typeof parsed.name === 'string' && parsed.name.trim()) ||
        params.filename.replace(/\.(zip|json)$/i, ''),
      summary:
        typeof parsed.author === 'string' && parsed.author
          ? `Author: ${parsed.author}`
          : '',
      mcVersion,
      loader,
      entries: Array.from(entriesMap.values()),
      unresolvedCount: 0,
    };
  }

  throw new Error(
    '対応していない形式です（Modrinth .mrpack / modrinth.index.json または CurseForge manifest.json に対応）'
  );
}

