import {
  type DatabaseSnapshot,
  deleteSetting,
  exportDatabaseSnapshot,
  getDbStats,
  getSetting,
  importDatabaseSnapshot,
  setSetting,
} from '@/lib/db';

export const GIST_FILENAME = 'mc-mod-db-backup.json';

function extractGistId(raw?: string): string {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return '';
  if (trimmed.includes('/')) {
    const parts = trimmed.split('/').filter(Boolean);
    return parts[parts.length - 1] ?? '';
  }
  return trimmed;
}

function githubHeaders(token?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchGitHubJson<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      ...githubHeaders(token),
      ...(options.headers as Record<string, string> | undefined),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let msg = `GitHub API エラー (HTTP ${res.status})`;
    try {
      const errBody = (await res.json()) as { message?: string };
      if (errBody?.message) {
        msg = `GitHub API エラー (${res.status}): ${errBody.message}`;
      }
    } catch {
      // ignore json parse failure
    }
    throw new Error(msg);
  }

  return (await res.json()) as T;
}

export async function verifyAndSaveGitHubToken(
  rawToken: string,
  rawGistId?: string
): Promise<{
  username: string;
  gistId: string;
}> {
  const token = rawToken.trim();
  if (!token) {
    throw new Error('GitHub Personal Access Token を入力してください');
  }

  const user = await fetchGitHubJson<{ login?: string }>(
    'https://api.github.com/user',
    {},
    token
  );
  if (!user.login) {
    throw new Error('GitHub ユーザー情報の取得に失敗しました');
  }

  let resolvedGistId = extractGistId(rawGistId);
  if (resolvedGistId) {
    await fetchGitHubJson<{ id: string }>(
      `https://api.github.com/gists/${encodeURIComponent(resolvedGistId)}`,
      {},
      token
    );
  } else {
    resolvedGistId = (await findBackupGistId(token)) ?? '';
  }

  setSetting('github_gist_pat', token);
  setSetting('github_gist_user', user.login);
  if (resolvedGistId) {
    setSetting('github_gist_id', resolvedGistId);
  } else {
    deleteSetting('github_gist_id');
  }

  return {
    username: user.login,
    gistId: resolvedGistId,
  };
}

export function clearGitHubGistSettings(): void {
  deleteSetting('github_gist_pat');
  deleteSetting('github_gist_user');
  deleteSetting('github_gist_id');
  deleteSetting('github_gist_synced_at');
}

interface GitHubGistItem {
  id: string;
  html_url?: string;
  updated_at?: string;
  files?: Record<
    string,
    {
      filename?: string;
      content?: string;
      truncated?: boolean;
      raw_url?: string;
    }
  >;
}

export async function findBackupGistId(token: string): Promise<string | null> {
  const gists = await fetchGitHubJson<GitHubGistItem[]>(
    'https://api.github.com/gists?per_page=100',
    {},
    token
  );

  const matched = gists
    .filter((g) => Boolean(g.files && g.files[GIST_FILENAME]))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''));

  return matched[0]?.id ?? null;
}

export async function pushDatabaseToGist(customGistId?: string): Promise<{
  gistId: string;
  url: string;
  syncedAt: string;
  stats: ReturnType<typeof getDbStats>;
}> {
  const token = getSetting('github_gist_pat');
  if (!token) {
    throw new Error('先に GitHub Personal Access Token (gist権限) を保存してください');
  }

  let targetGistId =
    extractGistId(customGistId) || extractGistId(getSetting('github_gist_id') ?? '');
  if (!targetGistId) {
    targetGistId = (await findBackupGistId(token)) ?? '';
  }

  const snapshot = exportDatabaseSnapshot();
  const content = JSON.stringify(snapshot, null, 2);

  let result: GitHubGistItem;
  if (targetGistId) {
    result = await fetchGitHubJson<GitHubGistItem>(
      `https://api.github.com/gists/${encodeURIComponent(targetGistId)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `MC MOD DB Backup (${snapshot.mods.length} mods)`,
          files: {
            [GIST_FILENAME]: { content },
          },
        }),
      },
      token
    );
  } else {
    result = await fetchGitHubJson<GitHubGistItem>(
      'https://api.github.com/gists',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: `MC MOD DB Backup (${snapshot.mods.length} mods)`,
          public: false,
          files: {
            [GIST_FILENAME]: { content },
          },
        }),
      },
      token
    );
  }

  const syncedAt = new Date().toISOString();
  setSetting('github_gist_id', result.id);
  setSetting('github_gist_synced_at', syncedAt);

  return {
    gistId: result.id,
    url: result.html_url ?? `https://gist.github.com/${result.id}`,
    syncedAt,
    stats: getDbStats(),
  };
}

export async function pullDatabaseFromGist(customGistId?: string): Promise<{
  gistId: string;
  url: string;
  syncedAt: string;
  stats: ReturnType<typeof getDbStats>;
}> {
  const token = getSetting('github_gist_pat');
  let targetGistId =
    extractGistId(customGistId) || extractGistId(getSetting('github_gist_id') ?? '');

  if (!targetGistId && token) {
    targetGistId = (await findBackupGistId(token)) ?? '';
  }

  if (!targetGistId) {
    throw new Error(
      '復元対象の Gist が見つかりません（トークンを保存するか、Gist ID / URL を指定してください）'
    );
  }

  const gist = await fetchGitHubJson<GitHubGistItem>(
    `https://api.github.com/gists/${encodeURIComponent(targetGistId)}`,
    {},
    token
  );

  const fileEntry =
    gist.files?.[GIST_FILENAME] ??
    Object.values(gist.files ?? {}).find((f) => f.filename?.endsWith('.json'));

  if (!fileEntry) {
    throw new Error(`Gist 内に ${GIST_FILENAME} が見つかりませんでした`);
  }

  let rawText = fileEntry.content ?? '';
  if ((fileEntry.truncated || !rawText) && fileEntry.raw_url) {
    const rawRes = await fetch(fileEntry.raw_url, { cache: 'no-store' });
    if (!rawRes.ok) {
      throw new Error(`Gist ファイルのダウンロードに失敗しました (${rawRes.status})`);
    }
    rawText = await rawRes.text();
  }

  const parsed = JSON.parse(rawText) as Partial<DatabaseSnapshot>;
  const stats = await importDatabaseSnapshot(parsed);

  const syncedAt = new Date().toISOString();
  setSetting('github_gist_id', gist.id);
  setSetting('github_gist_synced_at', syncedAt);

  return {
    gistId: gist.id,
    url: gist.html_url ?? `https://gist.github.com/${gist.id}`,
    syncedAt,
    stats,
  };
}
