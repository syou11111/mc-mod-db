'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Cloud,
  CloudDownload,
  CloudUpload,
  Database,
  Download,
  ExternalLink,
  KeyRound,
  Loader2,
  Upload,
  X,
} from 'lucide-react';

interface SettingsModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export function SettingsModal({ open, onClose, onSaved }: SettingsModalProps) {
  const [cfKey, setCfKey] = useState('');
  const [masked, setMasked] = useState('');
  const [configured, setConfigured] = useState(false);

  const [ghConfigured, setGhConfigured] = useState(false);
  const [ghAutoSync, setGhAutoSync] = useState(true);
  const [ghUser, setGhUser] = useState('');
  const [ghToken, setGhToken] = useState('');
  const [gistIdInput, setGistIdInput] = useState('');
  const [ghSyncedAt, setGhSyncedAt] = useState('');
  const [gistUrl, setGistUrl] = useState('');

  const [stats, setStats] = useState({
    mods: 0,
    tags: 0,
    versions: 0,
    presets: 0,
  });

  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refreshSettings() {
    try {
      const res = await fetch('/api/settings');
      const data = await res.json();
      setConfigured(Boolean(data.curseforgeConfigured));
      setMasked(data.curseforgeKeyMasked ?? '');
      setGhConfigured(Boolean(data.githubGistConfigured));
      setGhAutoSync(
        data.githubGistAutoSync !== undefined
          ? Boolean(data.githubGistAutoSync)
          : Boolean(data.githubGistConfigured)
      );
      setGhUser(data.githubGistUser ?? '');
      setGistIdInput(data.githubGistId ?? '');
      setGhSyncedAt(data.githubGistSyncedAt ?? '');
      if (data.githubGistId) {
        setGistUrl(`https://gist.github.com/${data.githubGistId}`);
      } else {
        setGistUrl('');
      }
      if (data.stats) setStats(data.stats);
    } catch {
      // ignore load error
    }
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setNotice(null);
    void refreshSettings();
  }, [open]);

  if (!open) return null;

  async function handleSaveCurseForge(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_curseforge',
          curseforgeApiKey: cfKey,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存に失敗しました');
      setConfigured(Boolean(data.curseforgeConfigured));
      setMasked(data.curseforgeKeyMasked ?? '');
      setCfKey('');
      setNotice('CurseForge APIキーを保存・検証しました');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleClearCurseForge() {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_curseforge',
          curseforgeApiKey: '',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '削除に失敗しました');
      setConfigured(Boolean(data.curseforgeConfigured));
      setMasked(data.curseforgeKeyMasked ?? '');
      setNotice('CurseForge APIキーをクリアしました');
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleExportJson() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'export_json' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '書き出しに失敗しました');

      const blob = new Blob([JSON.stringify(data.snapshot, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.filename || 'mc-mod-db-backup.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setNotice(`${data.filename} をダウンロードしました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '書き出しに失敗しました');
    } finally {
      setSyncing(false);
    }
  }

  async function handleImportJsonFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'import_json', snapshot: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '読み込みに失敗しました');
      if (data.stats) setStats(data.stats);
      setNotice(
        `JSONから復元しました（MOD ${data.stats?.mods ?? 0}件 / タグ ${data.stats?.tags ?? 0}件 / プリセット ${data.stats?.presets ?? 0}件）`
      );
      onSaved();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'JSONファイルの読み込みに失敗しました'
      );
    } finally {
      setSyncing(false);
    }
  }

  async function handleSaveGitHub(e: React.FormEvent) {
    e.preventDefault();
    if (!ghToken.trim()) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_github',
          githubToken: ghToken.trim(),
          gistId: gistIdInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'GitHub トークン検証に失敗しました');
      setGhConfigured(true);
      setGhAutoSync(Boolean(data.githubGistAutoSync ?? true));
      setGhUser(data.githubGistUser ?? '');
      setGistIdInput(data.githubGistId ?? '');
      if (data.githubGistId) {
        setGistUrl(`https://gist.github.com/${data.githubGistId}`);
      }
      setGhToken('');
      setNotice(
        `GitHub (@${data.githubGistUser}) と連携しました${
          data.githubGistId ? `（既存Gist検出: ${data.githubGistId}）` : ''
        }`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'GitHub 連携に失敗しました');
    } finally {
      setSyncing(false);
    }
  }

  async function handleClearGitHub() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear_github' }),
      });
      setGhConfigured(false);
      setGhAutoSync(false);
      setGhUser('');
      setGistIdInput('');
      setGhSyncedAt('');
      setGistUrl('');
      setNotice('GitHub Gist 連携設定を解除しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '解除に失敗しました');
    } finally {
      setSyncing(false);
    }
  }

  async function handleToggleAutoSync(enabled: boolean) {
    setGhAutoSync(enabled);
    setError(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_github_auto_sync', enabled }),
      });
      if (res.ok) {
        setNotice(
          enabled
            ? 'Gist への自動保存を ON にしました（変更の約4秒後に自動Push）'
            : 'Gist への自動保存を OFF にしました（手動Pushのみ）'
        );
        onSaved();
      }
    } catch {
      // ignore toggle error
    }
  }

  async function handleGistPush() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'gist_push',
          gistId: gistIdInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gist への保存に失敗しました');
      setGistIdInput(data.gistId ?? '');
      setGhSyncedAt(data.syncedAt ?? '');
      if (data.url) setGistUrl(data.url);
      if (data.stats) setStats(data.stats);
      setNotice(`GitHub Gist (${data.gistId}) にバックアップを保存しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gist への保存に失敗しました');
    } finally {
      setSyncing(false);
    }
  }

  async function handleGistPull() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'gist_pull',
          gistId: gistIdInput.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Gist からの復元に失敗しました');
      setGistIdInput(data.gistId ?? '');
      setGhSyncedAt(data.syncedAt ?? '');
      if (data.url) setGistUrl(data.url);
      if (data.stats) setStats(data.stats);
      setNotice(
        `Gist (${data.gistId}) から復元しました（MOD ${data.stats?.mods ?? 0}件 / プリセット ${data.stats?.presets ?? 0}件）`
      );
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gist からの復元に失敗しました');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-800 bg-[#0f1623] p-6 shadow-2xl space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <h2 className="text-base font-bold text-white">
            API・データベース・同期設定
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {error && (
          <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {error}
          </div>
        )}
        {notice && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
            <span>{notice}</span>
            {gistUrl && (
              <a
                href={gistUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline hover:text-white"
              >
                Gist を開く
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        )}

        {/* IndexedDB Stats & JSON Export/Import */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Database className="h-4 w-4 text-emerald-400" />
              ブラウザ内 IndexedDB 統計
            </div>
            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[11px] text-emerald-300">
              ユーザーごと独立保存
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1 text-center sm:grid-cols-4">
            <div className="rounded-lg bg-slate-950 p-2.5">
              <div className="text-lg font-bold text-white">{stats.mods}</div>
              <div className="text-[11px] text-slate-400">登録MOD</div>
            </div>
            <div className="rounded-lg bg-slate-950 p-2.5">
              <div className="text-lg font-bold text-white">{stats.versions}</div>
              <div className="text-[11px] text-slate-400">対応バージョン</div>
            </div>
            <div className="rounded-lg bg-slate-950 p-2.5">
              <div className="text-lg font-bold text-white">{stats.tags}</div>
              <div className="text-[11px] text-slate-400">タグ総数</div>
            </div>
            <div className="rounded-lg bg-slate-950 p-2.5">
              <div className="text-lg font-bold text-white">{stats.presets}</div>
              <div className="text-[11px] text-slate-400">プリセット</div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3">
            <p className="text-[11px] text-slate-400">
              別PC移行やバックアップ用に全データをJSONで書き出し・復元できます（APIキーは含まれません）。
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={syncing}
                onClick={handleExportJson}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5 text-emerald-400" />
                💾 JSON書き出し (Export)
              </button>
              <button
                type="button"
                disabled={syncing}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/40 bg-sky-500/15 px-3 py-1.5 text-xs font-semibold text-sky-200 hover:bg-sky-500/25 disabled:opacity-50"
              >
                <Upload className="h-3.5 w-3.5" />
                📂 JSON読み込み (Import)
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                onChange={handleImportJsonFile}
                className="hidden"
              />
            </div>
          </div>
        </div>

        {/* GitHub Gist Cloud Sync */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-200">
              <Cloud className="h-4 w-4 text-sky-400" />
              GitHub Gist クラウド同期（自分の非公開Gistに保存）
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                ghConfigured
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {ghConfigured ? `連携済み (@${ghUser || 'user'})` : '未設定'}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            <a
              href="https://github.com/settings/tokens/new?description=MC+MOD+DB+Gist+Sync&scopes=gist"
              target="_blank"
              rel="noreferrer"
              className="text-sky-300 underline hover:text-sky-200"
            >
              GitHub トークン作成ページ（gist 権限のみ）
            </a>{' '}
            で発行した Personal Access Token を設定すると、自分の非公開 Gist にDBを保存・別PCへ復元できます（トークンはこのブラウザの localStorage のみに保存されます）。
          </p>

          <form onSubmit={handleSaveGitHub} className="space-y-2.5">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <input
                type="password"
                value={ghToken}
                onChange={(e) => setGhToken(e.target.value)}
                placeholder={
                  ghConfigured
                    ? '新しいトークンで上書き (ghp_... / github_pat_...)'
                    : 'GitHub Token (ghp_... / github_pat_...)'
                }
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
              <input
                type="text"
                value={gistIdInput}
                onChange={(e) => setGistIdInput(e.target.value)}
                placeholder="Gist ID または URL（空欄で自動作成・自動検索）"
                className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
              />
            </div>

            {ghConfigured && (
              <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-200 hover:border-sky-500/40">
                <input
                  type="checkbox"
                  checked={ghAutoSync}
                  onChange={(e) => handleToggleAutoSync(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-900 accent-sky-500"
                />
                <span>
                  変更時に自動で Gist へ保存する（MOD・タグ・プリセット変更の約4秒後に自動Push）
                </span>
              </label>
            )}

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="text-[11px] text-slate-500">
                {ghSyncedAt
                  ? `最終同期: ${new Date(ghSyncedAt).toLocaleString('ja-JP')}`
                  : 'まだ Gist と同期されていません'}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {ghConfigured && (
                  <button
                    type="button"
                    disabled={syncing}
                    onClick={handleClearGitHub}
                    className="rounded-lg border border-slate-700 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
                  >
                    解除
                  </button>
                )}
                <button
                  type="submit"
                  disabled={syncing || !ghToken.trim()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-600 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-40"
                >
                  {syncing && <Loader2 className="h-3 w-3 animate-spin" />}
                  🔑 トークン保存
                </button>
                <button
                  type="button"
                  disabled={syncing || !ghConfigured}
                  onClick={handleGistPush}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                >
                  <CloudUpload className="h-3.5 w-3.5" />
                  ☁️ Gist に保存 (Push)
                </button>
                <button
                  type="button"
                  disabled={syncing || (!ghConfigured && !gistIdInput.trim())}
                  onClick={handleGistPull}
                  className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-40"
                >
                  <CloudDownload className="h-3.5 w-3.5" />
                  📥 Gist から復元 (Pull)
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* CurseForge API Key */}
        <form
          onSubmit={handleSaveCurseForge}
          className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 space-y-3"
        >
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
              <KeyRound className="h-4 w-4 text-orange-400" />
              CurseForge Core API キー
            </label>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                configured
                  ? 'bg-emerald-500/20 text-emerald-300'
                  : 'bg-slate-800 text-slate-400'
              }`}
            >
              {configured ? `設定済み (${masked})` : '未設定'}
            </span>
          </div>

          <p className="text-xs leading-relaxed text-slate-400">
            Modrinth は APIキー不要で使えます。CurseForge も検索・インポートしたい場合は{' '}
            <a
              href="https://console.curseforge.com/"
              target="_blank"
              rel="noreferrer"
              className="text-orange-300 underline hover:text-orange-200"
            >
              CurseForge for Studios
            </a>{' '}
            で無料発行した API キー（$2a$10$...）を貼り付けてください。
          </p>

          <input
            type="password"
            value={cfKey}
            onChange={(e) => setCfKey(e.target.value)}
            placeholder="$2a$10$..."
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-orange-500 focus:outline-none"
          />

          <div className="flex items-center justify-end gap-2 pt-1">
            {configured && (
              <button
                type="button"
                onClick={handleClearCurseForge}
                disabled={saving}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                キーを削除
              </button>
            )}
            <button
              type="submit"
              disabled={saving || !cfKey.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-orange-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
            >
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              検証して保存
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
