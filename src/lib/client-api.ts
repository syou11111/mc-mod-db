import {
  type DatabaseSnapshot,
  addModRelation,
  addTagRelation,
  createOrGetTag,
  createPreset,
  deleteMod,
  deletePreset,
  deleteSetting,
  deleteTag,
  ensureDbInitialized,
  exportDatabaseSnapshot,
  getDbStats,
  getModById,
  getPresetById,
  getSetting,
  importDatabaseSnapshot,
  listAllTags,
  listPresets,
  removeModRelation,
  removePresetItem,
  removeTagRelation,
  searchLocalMods,
  setSetting,
  updateModMetadata,
  updatePreset,
  updateTag,
  upsertPresetItem,
} from '@/lib/db';
import {
  discoverExternalMods,
  fetchAndLinkDependenciesForMod,
  getCurseForgeApiKey,
  importModFromExternal,
  syncModById,
  type LinkedDependencyInfo,
} from '@/lib/external-mods';
import {
  clearGitHubGistSettings,
  pullDatabaseFromGist,
  pushDatabaseToGist,
  verifyAndSaveGitHubToken,
} from '@/lib/gist-sync';
import { buildMrpackArchive } from '@/lib/mrpack';
import type {
  ModRelationType,
  ModSide,
  ModSort,
  ModSource,
  ModStatus,
  PresetRequirement,
} from '@/types/mod';

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function splitCsv(val: string | null): string[] {
  if (!val) return [];
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function maskKey(key: string | null | undefined): string {
  if (!key) return '';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function parseRequestJson(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Record<string, unknown>> {
  if (typeof init?.body === 'string' && init.body.trim()) {
    return JSON.parse(init.body) as Record<string, unknown>;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    try {
      const cloned = input.clone();
      const text = await cloned.text();
      if (text.trim()) {
        return JSON.parse(text) as Record<string, unknown>;
      }
    } catch {
      // ignore empty body
    }
  }
  return {};
}

export async function handleApiRequest(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  await ensureDbInitialized();

  const rawUrl =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;

  const base =
    typeof window !== 'undefined' ? window.location.href : 'http://localhost';
  const url = new URL(rawUrl, base);
  const apiIdx = url.pathname.indexOf('/api/');
  const apiPath = apiIdx >= 0 ? url.pathname.slice(apiIdx) : url.pathname;
  const method = (
    init?.method ??
    (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET')
  ).toUpperCase();

  try {
    // 1. /api/mods
    if (apiPath === '/api/mods') {
      if (method === 'GET') {
        const sp = url.searchParams;
        const data = searchLocalMods({
          q: sp.get('q') ?? undefined,
          mcVersions: splitCsv(sp.get('mcVersions')),
          loaders: splitCsv(sp.get('loaders')),
          andTags: splitCsv(sp.get('andTags')),
          orTags: splitCsv(sp.get('orTags')),
          notTags: splitCsv(sp.get('notTags')),
          expandMetaTags: sp.get('expandMetaTags') !== 'false',
          status: (sp.get('status') as ModStatus | 'all') ?? 'all',
          clientSide: (sp.get('clientSide') as ModSide | 'all') ?? 'all',
          serverSide: (sp.get('serverSide') as ModSide | 'all') ?? 'all',
          sort: (sp.get('sort') as ModSort) ?? 'updated_desc',
        });
        return jsonResponse(data);
      }

      if (method === 'POST') {
        const body = (await parseRequestJson(input, init)) as {
          input?: string;
          source?: ModSource;
          idOrSlug?: string;
          tagIds?: string[];
          mergeIntoModId?: string;
          autoDependencies?: boolean;
          items?: Array<{ source: ModSource; idOrSlug: string }>;
        };
        const autoDep = body.autoDependencies !== false;

        if (Array.isArray(body.items) && body.items.length > 0) {
          const imported: Array<{ mod: unknown; action: string }> = [];
          const linkedMap = new Map<string, LinkedDependencyInfo>();
          const errors: Array<{ target: string; error: string }> = [];

          for (const item of body.items) {
            try {
              const res = await importModFromExternal({
                source: item.source,
                idOrSlug: item.idOrSlug,
                initialTagIds: body.tagIds,
                autoLinkDependencies: autoDep,
              });
              imported.push({ mod: res.mod, action: res.action });
              for (const dep of res.linkedDependencies) {
                const prev = linkedMap.get(dep.id);
                linkedMap.set(dep.id, {
                  id: dep.id,
                  name: dep.name,
                  newlyImported: Boolean(prev?.newlyImported || dep.newlyImported),
                });
              }
            } catch (err) {
              errors.push({
                target: `${item.source}:${item.idOrSlug}`,
                error: err instanceof Error ? err.message : '登録に失敗しました',
              });
            }
          }

          return jsonResponse(
            {
              imported,
              linkedDependencies: Array.from(linkedMap.values()),
              errors,
              mod: imported[0]?.mod ?? null,
            },
            imported.length > 0 ? 200 : 400
          );
        }

        const res = await importModFromExternal({
          input: body.input,
          source: body.source,
          idOrSlug: body.idOrSlug,
          initialTagIds: body.tagIds,
          mergeIntoModId: body.mergeIntoModId,
          autoLinkDependencies: autoDep,
        });

        return jsonResponse({
          mod: res.mod,
          action: res.action,
          linkedDependencies: res.linkedDependencies,
          imported: [{ mod: res.mod, action: res.action }],
          errors: [],
        });
      }
    }

    // 2. /api/mods/:id/sync
    const syncMatch = apiPath.match(/^\/api\/mods\/([^/]+)\/sync$/);
    if (syncMatch && method === 'POST') {
      const modId = decodeURIComponent(syncMatch[1]);
      const mod = await syncModById(modId);
      return jsonResponse({ mod });
    }

    // 3. /api/mods/:id/relations
    const relMatch = apiPath.match(/^\/api\/mods\/([^/]+)\/relations$/);
    if (relMatch) {
      const modId = decodeURIComponent(relMatch[1]);
      if (method === 'POST') {
        const body = (await parseRequestJson(input, init)) as {
          autoFetchDependencies?: boolean;
          relatedModId?: string;
          relationType?: ModRelationType;
          note?: string;
        };

        if (body.autoFetchDependencies) {
          const result = await fetchAndLinkDependenciesForMod(modId);
          return jsonResponse(result);
        }

        if (!body.relatedModId || !body.relationType) {
          return jsonResponse(
            { error: '関連MODと関係種別（dependency / alternative）を指定してください' },
            400
          );
        }

        addModRelation(modId, body.relatedModId, body.relationType, body.note ?? '');
        const mod = getModById(modId);
        if (!mod) {
          return jsonResponse({ error: 'MODが見つかりません' }, 404);
        }
        return jsonResponse({ mod });
      }

      if (method === 'DELETE') {
        const body = (await parseRequestJson(input, init)) as {
          relatedModId?: string;
          relationType?: ModRelationType;
        };
        if (!body.relatedModId || !body.relationType) {
          return jsonResponse(
            { error: '関連MODと関係種別を指定してください' },
            400
          );
        }
        removeModRelation(modId, body.relatedModId, body.relationType);
        const mod = getModById(modId);
        if (!mod) {
          return jsonResponse({ error: 'MODが見つかりません' }, 404);
        }
        return jsonResponse({ mod });
      }
    }

    // 4. /api/mods/:id
    const modMatch = apiPath.match(/^\/api\/mods\/([^/]+)$/);
    if (modMatch) {
      const modId = decodeURIComponent(modMatch[1]);
      if (method === 'GET') {
        const mod = getModById(modId);
        if (!mod) return jsonResponse({ error: 'MODが見つかりません' }, 404);
        return jsonResponse({ mod });
      }
      if (method === 'PATCH') {
        const body = (await parseRequestJson(input, init)) as {
          jaName?: string;
          note?: string;
          status?: ModStatus;
          tagIds?: string[];
          linkExternalUrl?: string;
        };
        if (body.linkExternalUrl) {
          const merged = await importModFromExternal({
            input: body.linkExternalUrl,
            mergeIntoModId: modId,
          });
          return jsonResponse({ mod: merged.mod, action: merged.action });
        }
        const updated = updateModMetadata(modId, {
          jaName: body.jaName,
          note: body.note,
          status: body.status,
          tagIds: body.tagIds,
        });
        if (!updated) return jsonResponse({ error: 'MODが見つかりません' }, 404);
        return jsonResponse({ mod: updated });
      }
      if (method === 'DELETE') {
        const ok = deleteMod(modId);
        if (!ok) return jsonResponse({ error: 'MODが見つかりません' }, 404);
        return jsonResponse({ ok: true });
      }
    }

    // 5. /api/discover
    if (apiPath === '/api/discover' && method === 'GET') {
      const sp = url.searchParams;
      const result = await discoverExternalMods({
        source: (sp.get('source') as 'all' | ModSource) ?? 'all',
        q: sp.get('q') ?? '',
        mcVersion: sp.get('mcVersion') || undefined,
        loader: sp.get('loader') || undefined,
        sort: (sp.get('sort') as 'downloads' | 'relevance' | 'updated') ?? 'downloads',
        limit: Math.min(40, Math.max(1, Number(sp.get('limit') ?? 20) || 20)),
        offset: Math.max(0, Number(sp.get('offset') ?? 0) || 0),
        excludeInDb:
          sp.get('excludeInDb') === 'true' || sp.get('excludeInDb') === '1',
      });
      return jsonResponse(result);
    }

    // 6. /api/tags
    if (apiPath === '/api/tags') {
      if (method === 'GET') {
        return jsonResponse({ tags: listAllTags() });
      }
      if (method === 'POST') {
        const body = (await parseRequestJson(input, init)) as {
          name?: string;
          color?: string;
        };
        const tag = createOrGetTag(body.name ?? '', 'custom', body.color ?? '#3b82f6');
        return jsonResponse({ tag });
      }
    }

    // 7. /api/tags/relations
    if (apiPath === '/api/tags/relations') {
      const body = (await parseRequestJson(input, init)) as {
        parentTagId?: string;
        childTagId?: string;
      };
      if (!body.parentTagId || !body.childTagId) {
        return jsonResponse(
          { error: '親タグIDと子タグIDの両方を指定してください' },
          400
        );
      }
      if (method === 'POST') {
        addTagRelation(body.parentTagId, body.childTagId);
        return jsonResponse({ tags: listAllTags() });
      }
      if (method === 'DELETE') {
        removeTagRelation(body.parentTagId, body.childTagId);
        return jsonResponse({ tags: listAllTags() });
      }
    }

    // 8. /api/tags/:id
    const tagMatch = apiPath.match(/^\/api\/tags\/([^/]+)$/);
    if (tagMatch) {
      const tagId = decodeURIComponent(tagMatch[1]);
      if (method === 'PATCH') {
        const body = (await parseRequestJson(input, init)) as {
          name?: string;
          color?: string;
        };
        const tag = updateTag(tagId, body);
        if (!tag) return jsonResponse({ error: 'タグが見つかりません' }, 404);
        return jsonResponse({ tag });
      }
      if (method === 'DELETE') {
        const ok = deleteTag(tagId);
        if (!ok) return jsonResponse({ error: 'タグが見つかりません' }, 404);
        return jsonResponse({ ok: true });
      }
    }

    // 9. /api/presets
    if (apiPath === '/api/presets') {
      if (method === 'GET') {
        return jsonResponse({ presets: listPresets() });
      }
      if (method === 'POST') {
        const body = (await parseRequestJson(input, init)) as {
          name?: string;
          description?: string;
          color?: string;
        };
        const preset = createPreset({
          name: body.name ?? '',
          description: body.description,
          color: body.color,
        });
        return jsonResponse({ preset });
      }
    }

    // 10. /api/presets/mrpack
    if (apiPath === '/api/presets/mrpack' && method === 'POST') {
      const body = (await parseRequestJson(input, init)) as {
        name?: string;
        summary?: string;
        mcVersion?: string;
        loader?: string;
        modIds?: string[];
        includeDependencies?: boolean;
      };
      const mcVersion = body.mcVersion?.trim();
      const loader = body.loader?.trim().toLowerCase();
      const modIds = Array.isArray(body.modIds)
        ? body.modIds.filter((id) => typeof id === 'string' && id.trim().length > 0)
        : [];

      if (!mcVersion || !loader) {
        return jsonResponse(
          { error: 'mcVersion と loader を指定してください' },
          400
        );
      }
      if (modIds.length === 0) {
        return jsonResponse(
          { error: '出力対象の MOD を1つ以上指定してください' },
          400
        );
      }

      const result = await buildMrpackArchive({
        name: body.name,
        summary: body.summary,
        mcVersion,
        loader,
        modIds,
        includeDependencies: body.includeDependencies,
      });

      if (result.includedCount === 0) {
        return jsonResponse(
          {
            error:
              '指定条件 (MCバージョン × Loader) に対応した Modrinth ダウンロードURLが見つからなかったため、.mrpack を生成できませんでした',
            skippedMods: result.skippedMods,
          },
          400
        );
      }

      return jsonResponse(result);
    }

    // 11. /api/presets/:id
    const presetMatch = apiPath.match(/^\/api\/presets\/([^/]+)$/);
    if (presetMatch) {
      const presetId = decodeURIComponent(presetMatch[1]);
      if (method === 'GET') {
        const preset = getPresetById(presetId);
        if (!preset) {
          return jsonResponse({ error: 'プリセットが見つかりません' }, 404);
        }
        return jsonResponse({ preset });
      }
      if (method === 'PATCH') {
        const body = (await parseRequestJson(input, init)) as {
          name?: string;
          description?: string;
          color?: string;
          upsertMod?: {
            modId: string;
            requirement?: PresetRequirement;
            note?: string;
          };
          removeModId?: string;
        };
        let preset = getPresetById(presetId);
        if (!preset) {
          return jsonResponse({ error: 'プリセットが見つかりません' }, 404);
        }
        if (
          body.name !== undefined ||
          body.description !== undefined ||
          body.color !== undefined
        ) {
          preset = updatePreset(presetId, {
            name: body.name,
            description: body.description,
            color: body.color,
          });
        }
        if (body.upsertMod) {
          preset = upsertPresetItem(presetId, body.upsertMod);
        }
        if (body.removeModId) {
          preset = removePresetItem(presetId, body.removeModId);
        }
        return jsonResponse({ preset });
      }
      if (method === 'DELETE') {
        const ok = deletePreset(presetId);
        if (!ok) {
          return jsonResponse({ error: 'プリセットが見つかりません' }, 404);
        }
        return jsonResponse({ ok: true });
      }
    }

    // 12. /api/settings
    if (apiPath === '/api/settings') {
      if (method === 'GET') {
        const cfKey = getCurseForgeApiKey();
        const ghPat = getSetting('github_gist_pat');
        return jsonResponse({
          curseforgeConfigured: Boolean(cfKey),
          curseforgeKeyMasked: maskKey(cfKey),
          githubGistConfigured: Boolean(ghPat),
          githubGistUser: getSetting('github_gist_user') ?? '',
          githubGistId: getSetting('github_gist_id') ?? '',
          githubGistSyncedAt: getSetting('github_gist_synced_at') ?? '',
          stats: getDbStats(),
        });
      }

      if (method === 'POST') {
        const body = (await parseRequestJson(input, init)) as {
          action?: string;
          curseforgeApiKey?: string;
          githubToken?: string;
          gistId?: string;
          snapshot?: Partial<DatabaseSnapshot>;
        };

        if (body.action === 'export_json') {
          const dateStr = new Date().toISOString().slice(0, 10);
          return jsonResponse({
            ok: true,
            filename: `mc-mod-db-backup-${dateStr}.json`,
            snapshot: exportDatabaseSnapshot(),
            stats: getDbStats(),
          });
        }

        if (body.action === 'import_json') {
          if (!body.snapshot) {
            return jsonResponse({ error: 'インポートするJSONを指定してください' }, 400);
          }
          const stats = await importDatabaseSnapshot(body.snapshot);
          return jsonResponse({ ok: true, stats });
        }

        if (body.action === 'save_github') {
          const info = await verifyAndSaveGitHubToken(
            body.githubToken ?? '',
            body.gistId
          );
          return jsonResponse({
            ok: true,
            githubGistConfigured: true,
            githubGistUser: info.username,
            githubGistId: info.gistId,
          });
        }

        if (body.action === 'clear_github') {
          clearGitHubGistSettings();
          return jsonResponse({
            ok: true,
            githubGistConfigured: false,
            githubGistUser: '',
            githubGistId: '',
            githubGistSyncedAt: '',
          });
        }

        if (body.action === 'gist_push') {
          const res = await pushDatabaseToGist(body.gistId);
          return jsonResponse({ ok: true, ...res });
        }

        if (body.action === 'gist_pull') {
          const res = await pullDatabaseFromGist(body.gistId);
          return jsonResponse({ ok: true, ...res });
        }

        // CurseForge API key save / clear
        const nextKey = (body.curseforgeApiKey ?? '').trim();
        if (!nextKey) {
          deleteSetting('curseforge_api_key');
          return jsonResponse({
            ok: true,
            curseforgeConfigured: false,
            curseforgeKeyMasked: '',
          });
        }

        const testRes = await fetch('https://api.curseforge.com/v1/games/432', {
          headers: {
            'x-api-key': nextKey,
            Accept: 'application/json',
          },
          cache: 'no-store',
        });

        if (!testRes.ok) {
          return jsonResponse(
            {
              error: `CurseForge APIキーの検証に失敗しました (HTTP ${testRes.status})。キーが正しいか確認してください。`,
            },
            400
          );
        }

        setSetting('curseforge_api_key', nextKey);
        return jsonResponse({
          ok: true,
          curseforgeConfigured: true,
          curseforgeKeyMasked: maskKey(nextKey),
        });
      }
    }

    return jsonResponse({ error: `Not found: ${method} ${apiPath}` }, 404);
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : '処理に失敗しました' },
      400
    );
  }
}

const INTERCEPTOR_KEY = '__mc_mod_db_fetch_installed__';

export function installClientApiInterceptor(): void {
  if (typeof window === 'undefined') return;
  const win = window as unknown as Record<string, unknown>;
  if (win[INTERCEPTOR_KEY]) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const rawUrl =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;
      const parsed = new URL(rawUrl, window.location.href);
      if (
        parsed.origin === window.location.origin &&
        /(^|\/)api(\/|$)/.test(parsed.pathname)
      ) {
        return handleApiRequest(input, init);
      }
    } catch {
      // ignore URL parse error and fall through to native fetch
    }
    return originalFetch(input, init);
  };

  win[INTERCEPTOR_KEY] = true;
}
