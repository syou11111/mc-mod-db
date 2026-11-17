'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  Cloud,
  Database,
  ExternalLink,
  Filter,
  GitBranch,
  Globe,
  Layers,
  LayoutGrid,
  Link as LinkIcon,
  List,
  Loader2,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sparkles,
  Tag as TagIcon,
  Trash2,
} from 'lucide-react';
import {
  LOADER_LABELS,
  LoaderBadge,
  SIDE_LABELS,
  StatusBadge,
  TAG_PALETTE,
  TagPill,
  formatDownloads,
  isReleaseMcVersionClient,
} from '@/components/ModBadges';
import { ModDetailDrawer } from '@/components/ModDetailDrawer';
import { DiscoverPanel } from '@/components/DiscoverPanel';
import { PresetsPanel } from '@/components/PresetsPanel';
import { SettingsModal } from '@/components/SettingsModal';
import { TagHierarchyModal } from '@/components/TagHierarchyModal';
import { GIST_SYNC_EVENT, type GistSyncEventDetail } from '@/lib/gist-sync';
import type {
  ModRecord,
  ModSide,
  ModSort,
  ModStatus,
  ModTag,
} from '@/types/mod';

type TagFilterMode = 'and' | 'or' | 'not';

const CORE_LOADERS = ['fabric', 'neoforge', 'forge', 'quilt'];

const SAMPLE_MODS = [
  { source: 'modrinth' as const, idOrSlug: 'sodium' },
  { source: 'modrinth' as const, idOrSlug: 'iris' },
  { source: 'modrinth' as const, idOrSlug: 'lithium' },
  { source: 'modrinth' as const, idOrSlug: 'modmenu' },
  { source: 'modrinth' as const, idOrSlug: 'appleskin' },
  { source: 'modrinth' as const, idOrSlug: 'jade' },
];

export default function HomePage() {
  const [activeTab, setActiveTab] = useState<'library' | 'discover' | 'presets'>(
    'library'
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tagHierarchyOpen, setTagHierarchyOpen] = useState(false);
  const [gistConfigured, setGistConfigured] = useState(false);
  const [gistAutoSync, setGistAutoSync] = useState(false);
  const [gistSyncState, setGistSyncState] = useState<GistSyncEventDetail>({
    status: 'idle',
  });

  const refreshSyncConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) return;
      const data = await res.json();
      setGistConfigured(Boolean(data.githubGistConfigured));
      setGistAutoSync(Boolean(data.githubGistAutoSync));
      if (data.githubGistSyncedAt) {
        setGistSyncState((prev) =>
          prev.status === 'idle'
            ? { status: 'synced', syncedAt: data.githubGistSyncedAt }
            : prev
        );
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    void refreshSyncConfig();
    const onSyncEvent = (e: Event) => {
      const custom = e as CustomEvent<GistSyncEventDetail>;
      if (custom.detail) {
        setGistSyncState(custom.detail);
      }
    };
    window.addEventListener(GIST_SYNC_EVENT, onSyncEvent);
    return () => window.removeEventListener(GIST_SYNC_EVENT, onSyncEvent);
  }, [refreshSyncConfig]);

  // Header quick URL import
  const [quickUrl, setQuickUrl] = useState('');
  const [quickAutoDeps, setQuickAutoDeps] = useState(true);
  const [quickImporting, setQuickImporting] = useState(false);
  const [quickNotice, setQuickNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);

  // Library query & facets
  const [mods, setMods] = useState<ModRecord[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<ModTag[]>([]);
  const [loadingMods, setLoadingMods] = useState(true);

  const [q, setQ] = useState('');
  const [selectedLoaders, setSelectedLoaders] = useState<string[]>([]);
  const [selectedVersions, setSelectedVersions] = useState<string[]>([]);
  const [releaseVersionsOnly, setReleaseVersionsOnly] = useState(true);
  const [versionSearch, setVersionSearch] = useState('');

  const [tagFilters, setTagFilters] = useState<Record<string, TagFilterMode>>({});
  const [expandMetaTags, setExpandMetaTags] = useState(true);
  const [tagTab, setTagTab] = useState<'custom' | 'official'>('custom');
  const [tagSearch, setTagSearch] = useState('');

  const [statusFilter, setStatusFilter] = useState<ModStatus | 'all'>('all');
  const [clientFilter, setClientFilter] = useState<ModSide | 'all'>('all');
  const [serverFilter, setServerFilter] = useState<ModSide | 'all'>('all');
  const [sort, setSort] = useState<ModSort>('updated_desc');
  const [viewMode, setViewMode] = useState<'card' | 'table'>('card');

  // New tag creation & inline edit in sidebar
  const [showNewTagForm, setShowNewTagForm] = useState(false);
  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_PALETTE[0]);
  const [tagEditMode, setTagEditMode] = useState(false);
  const [tagDraftNames, setTagDraftNames] = useState<Record<string, string>>({});
  const [tagMutatingId, setTagMutatingId] = useState<string | null>(null);

  // Inline quick tag popover on card
  const [openInlineTagModId, setOpenInlineTagModId] = useState<string | null>(null);
  const inlinePopoverRef = useRef<HTMLDivElement | null>(null);

  // Detail drawer & sample import
  const [detailModId, setDetailModId] = useState<string | null>(null);
  const [seedingSamples, setSeedingSamples] = useState(false);

  const fetchMods = useCallback(async () => {
    setLoadingMods(true);
    try {
      const andTags: string[] = [];
      const orTags: string[] = [];
      const notTags: string[] = [];
      for (const [id, mode] of Object.entries(tagFilters)) {
        if (mode === 'and') andTags.push(id);
        else if (mode === 'or') orTags.push(id);
        else if (mode === 'not') notTags.push(id);
      }

      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (selectedVersions.length > 0) qs.set('mcVersions', selectedVersions.join(','));
      if (selectedLoaders.length > 0) qs.set('loaders', selectedLoaders.join(','));
      if (andTags.length > 0) qs.set('andTags', andTags.join(','));
      if (orTags.length > 0) qs.set('orTags', orTags.join(','));
      if (notTags.length > 0) qs.set('notTags', notTags.join(','));
      qs.set('expandMetaTags', expandMetaTags ? 'true' : 'false');
      if (statusFilter !== 'all') qs.set('status', statusFilter);
      if (clientFilter !== 'all') qs.set('clientSide', clientFilter);
      if (serverFilter !== 'all') qs.set('serverSide', serverFilter);
      qs.set('sort', sort);

      const res = await fetch(`/api/mods?${qs.toString()}`);
      const data = await res.json();
      if (res.ok) {
        setMods(data.mods ?? []);
        setTotalCount(data.totalCount ?? 0);
        setAvailableVersions(data.facets?.mcVersions ?? []);
        setAllTags(data.facets?.tags ?? []);
      }
    } finally {
      setLoadingMods(false);
    }
  }, [
    q,
    selectedVersions,
    selectedLoaders,
    tagFilters,
    expandMetaTags,
    statusFilter,
    clientFilter,
    serverFilter,
    sort,
  ]);

  useEffect(() => {
    const timer = setTimeout(() => {
      fetchMods();
    }, 120);
    return () => clearTimeout(timer);
  }, [fetchMods]);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (
        inlinePopoverRef.current &&
        !inlinePopoverRef.current.contains(e.target as Node)
      ) {
        setOpenInlineTagModId(null);
      }
    }
    if (openInlineTagModId) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [openInlineTagModId]);

  async function handleQuickUrlImport(e: React.FormEvent) {
    e.preventDefault();
    if (!quickUrl.trim()) return;
    setQuickImporting(true);
    setQuickNotice(null);
    try {
      const res = await fetch('/api/mods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: quickUrl.trim(),
          autoDependencies: quickAutoDeps,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登録に失敗しました');
      const actionLabel =
        data.action === 'merged'
          ? '統合しました'
          : data.action === 'updated'
            ? '更新しました'
            : '登録しました';
      const deps: Array<{ name: string; newlyImported: boolean }> =
        Array.isArray(data.linkedDependencies) ? data.linkedDependencies : [];
      const depSuffix =
        deps.length > 0
          ? `（前提MOD ${deps.length}件も連携: ${deps.map((d) => d.name).join(', ')}）`
          : '';
      setQuickNotice({
        type: 'ok',
        text: `「${data.mod?.name ?? 'MOD'}」を${actionLabel}${depSuffix}`,
      });
      setQuickUrl('');
      fetchMods();
      if (data.mod?.id) {
        setDetailModId(data.mod.id);
      }
    } catch (err) {
      setQuickNotice({
        type: 'err',
        text: err instanceof Error ? err.message : '登録に失敗しました',
      });
    } finally {
      setQuickImporting(false);
    }
  }

  async function handleSeedSamples() {
    setSeedingSamples(true);
    setQuickNotice(null);
    try {
      const res = await fetch('/api/mods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: SAMPLE_MODS }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'サンプル取得に失敗しました');
      setQuickNotice({
        type: 'ok',
        text: `定番MOD ${data.imported?.length ?? 0} 件を登録しました`,
      });
      fetchMods();
    } catch (err) {
      setQuickNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'サンプル取得に失敗しました',
      });
    } finally {
      setSeedingSamples(false);
    }
  }

  async function handleCreateSidebarTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setNewTagName('');
      setShowNewTagForm(false);
      fetchMods();
    } catch (err) {
      setQuickNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'タグ作成に失敗しました',
      });
    }
  }

  async function handleRenameSidebarTag(tag: ModTag) {
    const nextName = (tagDraftNames[tag.id] ?? tag.name).trim();
    if (!nextName || nextName === tag.name) return;
    setTagMutatingId(tag.id);
    try {
      const res = await fetch(`/api/tags/${tag.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName, color: tag.color }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'タグ名の変更に失敗しました');
      setTagDraftNames((prev) => {
        const next = { ...prev };
        delete next[tag.id];
        return next;
      });
      setQuickNotice({
        type: 'ok',
        text: `タグ「${tag.name}」を「${nextName}」に変更しました`,
      });
      fetchMods();
    } catch (err) {
      setQuickNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'タグ名の変更に失敗しました',
      });
    } finally {
      setTagMutatingId(null);
    }
  }

  async function handleDeleteSidebarTag(tag: ModTag) {
    if (
      !confirm(
        `タグ「${tag.name}」を削除しますか？（MODへの付与や階層設定からも解除されます）`
      )
    ) {
      return;
    }
    setTagMutatingId(tag.id);
    try {
      const res = await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'タグ削除に失敗しました');
      setTagFilters((prev) => {
        if (!(tag.id in prev)) return prev;
        const next = { ...prev };
        delete next[tag.id];
        return next;
      });
      setQuickNotice({
        type: 'ok',
        text: `タグ「${tag.name}」を削除しました`,
      });
      fetchMods();
    } catch (err) {
      setQuickNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'タグ削除に失敗しました',
      });
    } finally {
      setTagMutatingId(null);
    }
  }

  async function handleInlineToggleTag(mod: ModRecord, tagId: string) {
    const currentIds = mod.tags.map((t) => t.id);
    const nextIds = currentIds.includes(tagId)
      ? currentIds.filter((id) => id !== tagId)
      : [...currentIds, tagId];

    const res = await fetch(`/api/mods/${mod.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tagIds: nextIds }),
    });
    if (res.ok) {
      const data = await res.json();
      setMods((prev) => prev.map((m) => (m.id === mod.id ? data.mod : m)));
      fetchMods();
    }
  }

  function cycleTagFilter(tagId: string) {
    setTagFilters((prev) => {
      const curr = prev[tagId];
      const next = { ...prev };
      if (!curr) next[tagId] = 'and';
      else if (curr === 'and') next[tagId] = 'or';
      else if (curr === 'or') next[tagId] = 'not';
      else delete next[tagId];
      return next;
    });
  }

  function toggleLoader(ld: string) {
    setSelectedLoaders((prev) =>
      prev.includes(ld) ? prev.filter((x) => x !== ld) : [...prev, ld]
    );
  }

  function toggleVersion(ver: string) {
    setSelectedVersions((prev) =>
      prev.includes(ver) ? prev.filter((x) => x !== ver) : [...prev, ver]
    );
  }

  function clearAllFilters() {
    setQ('');
    setSelectedLoaders([]);
    setSelectedVersions([]);
    setTagFilters({});
    setStatusFilter('all');
    setClientFilter('all');
    setServerFilter('all');
  }

  const filteredVersionOptions = useMemo(() => {
    const base = releaseVersionsOnly
      ? availableVersions.filter(isReleaseMcVersionClient)
      : availableVersions;
    if (!versionSearch.trim()) return base;
    const term = versionSearch.trim().toLowerCase();
    return base.filter((v) => v.toLowerCase().includes(term));
  }, [availableVersions, releaseVersionsOnly, versionSearch]);

  const displayedTags = useMemo(() => {
    const base = allTags.filter((t) => t.kind === tagTab);
    if (!tagSearch.trim()) return base;
    const term = tagSearch.trim().toLowerCase();
    return base.filter((t) => t.name.toLowerCase().includes(term));
  }, [allTags, tagTab, tagSearch]);

  const customTags = useMemo(
    () => allTags.filter((t) => t.kind === 'custom'),
    [allTags]
  );

  const hasActiveFilters =
    Boolean(q.trim()) ||
    selectedLoaders.length > 0 ||
    selectedVersions.length > 0 ||
    Object.keys(tagFilters).length > 0 ||
    statusFilter !== 'all' ||
    clientFilter !== 'all' ||
    serverFilter !== 'all';

  return (
    <div className="min-h-screen flex flex-col bg-[#0b0f17]">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-800/90 bg-[#0b0f17]/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-700 text-white shadow-lg shadow-emerald-950/50">
                <Database className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-base font-extrabold tracking-tight text-white">
                    MC MOD Database
                  </h1>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
                    {totalCount} MODs
                  </span>
                </div>
                <p className="text-[11px] text-slate-400">
                  バージョン×ローダー厳密検索 &amp; カスタムタグ管理
                </p>
              </div>
            </div>

            <nav className="flex items-center rounded-xl border border-slate-800 bg-slate-900/80 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('library')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition ${
                  activeTab === 'library'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Database className="h-3.5 w-3.5" />
                マイMODデータベース
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('discover')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition ${
                  activeTab === 'discover'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Globe className="h-3.5 w-3.5" />
                外部検索・選択追加
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('presets')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition ${
                  activeTab === 'presets'
                    ? 'bg-emerald-600 text-white shadow'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                プリセット・互換チェック
              </button>
            </nav>
          </div>

          <div className="flex flex-1 items-center justify-end gap-2 max-w-xl">
            <form
              onSubmit={handleQuickUrlImport}
              className="flex flex-1 items-center gap-1.5 min-w-[260px]"
            >
              <div className="relative flex-1">
                <LinkIcon className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-500" />
                <input
                  type="text"
                  value={quickUrl}
                  onChange={(e) => setQuickUrl(e.target.value)}
                  placeholder="Modrinth / CurseForge URLを貼って即登録..."
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 py-1.5 pl-8 pr-3 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>
              <label
                title="必須の前提MODも自動検出して同時に登録・紐付けする"
                className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-lg border border-slate-700 bg-slate-950 px-2 py-1.5 text-[11px] text-slate-300 hover:border-slate-600"
              >
                <input
                  type="checkbox"
                  checked={quickAutoDeps}
                  onChange={(e) => setQuickAutoDeps(e.target.checked)}
                  className="h-3 w-3 rounded border-slate-600 bg-slate-900 accent-emerald-500"
                />
                前提自動
              </label>
              <button
                type="submit"
                disabled={quickImporting || !quickUrl.trim()}
                className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                {quickImporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                登録
              </button>
            </form>

            {gistConfigured && (
              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                title={
                  gistSyncState.error ||
                  (gistAutoSync
                    ? 'GitHub Gist 自動保存が有効です（変更の数秒後に自動Push）'
                    : 'GitHub Gist 連携中（自動保存OFF）')
                }
                className={`hidden sm:inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition ${
                  gistSyncState.status === 'error'
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                    : gistSyncState.status === 'syncing' ||
                        gistSyncState.status === 'pending'
                      ? 'border-sky-500/40 bg-sky-500/10 text-sky-200'
                      : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                }`}
              >
                {gistSyncState.status === 'syncing' ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Cloud className="h-3 w-3" />
                )}
                {gistSyncState.status === 'syncing'
                  ? 'Gist保存中...'
                  : gistSyncState.status === 'pending'
                    ? 'Gist同期待機'
                    : gistSyncState.status === 'error'
                      ? 'Gist保存エラー'
                      : gistSyncState.syncedAt
                        ? `${gistAutoSync ? '自動保存' : '同期'} ${new Date(
                            gistSyncState.syncedAt
                          ).toLocaleTimeString('ja-JP', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}`
                        : gistAutoSync
                          ? 'Gist自動保存ON'
                          : 'Gist連携中'}
              </button>
            )}

            <button
              type="button"
              onClick={() => setSettingsOpen(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <Settings className="h-3.5 w-3.5" />
              API・設定
            </button>
          </div>
        </div>

        {quickNotice && (
          <div
            className={`border-t px-4 py-1.5 text-center text-xs font-medium ${
              quickNotice.type === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
                : 'border-rose-500/30 bg-rose-500/10 text-rose-200'
            }`}
          >
            {quickNotice.text}
          </div>
        )}
      </header>

      {/* Main Content */}
      <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-5">
        {activeTab === 'discover' ? (
          <DiscoverPanel
            allTags={allTags}
            onImported={fetchMods}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : activeTab === 'presets' ? (
          <PresetsPanel onOpenModDetail={(id) => setDetailModId(id)} />
        ) : (
          <div className="flex flex-col gap-5 lg:flex-row">
            {/* Sidebar Filters */}
            <aside className="w-full shrink-0 space-y-4 lg:w-72 xl:w-80">
              <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-bold text-white">
                    <Filter className="h-4 w-4 text-emerald-400" />
                    絞り込み条件
                  </div>
                  {hasActiveFilters && (
                    <button
                      type="button"
                      onClick={clearAllFilters}
                      className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white"
                    >
                      <RotateCcw className="h-3 w-3" />
                      すべて解除
                    </button>
                  )}
                </div>

                {/* Loader Filter */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">MODローダー</span>
                    {selectedLoaders.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setSelectedLoaders([])}
                        className="text-[11px] text-slate-400 hover:text-white"
                      >
                        クリア
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {CORE_LOADERS.map((ld) => {
                      const active = selectedLoaders.includes(ld);
                      return (
                        <button
                          key={ld}
                          type="button"
                          onClick={() => toggleLoader(ld)}
                          className={`flex items-center justify-between rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
                            active
                              ? 'border-emerald-500 bg-emerald-500/20 text-white'
                              : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700 hover:text-slate-200'
                          }`}
                        >
                          <span>{LOADER_LABELS[ld] ?? ld}</span>
                          {active && <Check className="h-3.5 w-3.5 text-emerald-400" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* MC Version Filter */}
                <div className="space-y-2 border-t border-slate-800 pt-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-300">
                      MCバージョン
                      {selectedLoaders.length > 0 && (
                        <span className="ml-1 text-[10px] font-normal text-emerald-400">
                          (厳密一致)
                        </span>
                      )}
                    </span>
                    <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={releaseVersionsOnly}
                        onChange={(e) => setReleaseVersionsOnly(e.target.checked)}
                        className="rounded border-slate-600 bg-slate-950 text-emerald-500"
                      />
                      正式版のみ
                    </label>
                  </div>

                  {availableVersions.length > 0 && (
                    <input
                      type="text"
                      value={versionSearch}
                      onChange={(e) => setVersionSearch(e.target.value)}
                      placeholder="バージョン検索 (例: 1.20.1)"
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  )}

                  {filteredVersionOptions.length === 0 ? (
                    <p className="text-[11px] text-slate-500">
                      MODを登録すると対応バージョンがここに表示されます
                    </p>
                  ) : (
                    <div className="flex max-h-40 flex-wrap gap-1.5 overflow-y-auto pr-1">
                      {filteredVersionOptions.map((ver) => {
                        const active = selectedVersions.includes(ver);
                        return (
                          <button
                            key={ver}
                            type="button"
                            onClick={() => toggleVersion(ver)}
                            className={`rounded-md border px-2 py-1 font-mono text-[11px] transition ${
                              active
                                ? 'border-emerald-500 bg-emerald-500/20 font-semibold text-emerald-200'
                                : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:border-slate-700 hover:text-white'
                            }`}
                          >
                            {ver}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Flexible Tag Filter */}
                <div className="space-y-2.5 border-t border-slate-800 pt-3">
                  <div className="space-y-1.5">
                    <span className="flex items-center gap-1 text-xs font-semibold text-slate-300">
                      <TagIcon className="h-3.5 w-3.5 text-sky-400" />
                      タグ検索 (AND / OR / NOT)
                    </span>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setShowNewTagForm((v) => !v)}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-300 hover:bg-emerald-500/20"
                      >
                        <Plus className="h-3 w-3" />
                        新規タグ
                      </button>
                      <button
                        type="button"
                        onClick={() => setTagEditMode((v) => !v)}
                        className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium transition ${
                          tagEditMode
                            ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                            : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-amber-500/50 hover:text-amber-200'
                        }`}
                      >
                        <Pencil className="h-3 w-3" />
                        {tagEditMode ? '編集終了' : '名前変更・削除'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setTagHierarchyOpen(true)}
                        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium text-sky-300 hover:bg-sky-500/20"
                        title="タグの親子階層（メタタグ）を編集"
                      >
                        <GitBranch className="h-3 w-3" />
                        階層 (親子)
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={expandMetaTags}
                      onChange={(e) => setExpandMetaTags(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-950 text-emerald-500"
                    />
                    子タグも展開して検索（メタタグ展開）
                  </label>

                  {showNewTagForm && (
                    <form
                      onSubmit={handleCreateSidebarTag}
                      className="rounded-lg border border-slate-700 bg-slate-950 p-2.5 space-y-2"
                    >
                      <input
                        type="text"
                        value={newTagName}
                        onChange={(e) => setNewTagName(e.target.value)}
                        placeholder="タグ名..."
                        className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none"
                      />
                      <div className="flex items-center justify-between">
                        <div className="flex gap-1">
                          {TAG_PALETTE.slice(0, 7).map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => setNewTagColor(c)}
                              className={`h-4 w-4 rounded-full border ${
                                newTagColor === c ? 'border-white scale-110' : 'border-transparent'
                              }`}
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                        <button
                          type="submit"
                          className="rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500"
                        >
                          追加
                        </button>
                      </div>
                    </form>
                  )}

                  <div className="flex items-center justify-between rounded-lg bg-slate-950 p-1 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setTagTab('custom')}
                      className={`flex-1 rounded-md py-1 font-medium transition ${
                        tagTab === 'custom'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      カスタムタグ
                    </button>
                    <button
                      type="button"
                      onClick={() => setTagTab('official')}
                      className={`flex-1 rounded-md py-1 font-medium transition ${
                        tagTab === 'official'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      公式カテゴリ
                    </button>
                  </div>

                  <p className="text-[10px] text-slate-500">
                    {tagEditMode ? (
                      <span className="text-amber-300">
                        編集中：タグ名を変更して「保存」、またはごみ箱アイコンで削除できます
                      </span>
                    ) : (
                      <>
                        クリックで切替：
                        <span className="text-emerald-400">AND(必須)</span> →{' '}
                        <span className="text-sky-400">OR(いずれか)</span> →{' '}
                        <span className="text-rose-400">NOT(除外)</span>
                      </>
                    )}
                  </p>

                  {allTags.filter((t) => t.kind === tagTab).length > 8 && (
                    <input
                      type="text"
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      placeholder="タグ名で絞り込み..."
                      className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  )}

                  {tagEditMode ? (
                    <div className="max-h-64 space-y-1.5 overflow-y-auto pr-1">
                      {displayedTags.map((tag) => {
                        const draft = tagDraftNames[tag.id] ?? tag.name;
                        const changed = draft.trim() && draft.trim() !== tag.name;
                        const mutating = tagMutatingId === tag.id;
                        return (
                          <div
                            key={tag.id}
                            className="flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/90 p-1"
                          >
                            {tag.kind === 'custom' && (
                              <span
                                className="ml-1 h-2 w-2 shrink-0 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                            )}
                            <input
                              type="text"
                              value={draft}
                              onChange={(e) =>
                                setTagDraftNames((prev) => ({
                                  ...prev,
                                  [tag.id]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleRenameSidebarTag(tag);
                                }
                              }}
                              disabled={mutating}
                              className="min-w-0 flex-1 rounded bg-slate-900 px-1.5 py-0.5 text-[11px] text-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
                            />
                            <button
                              type="button"
                              disabled={mutating || !changed}
                              onClick={() => handleRenameSidebarTag(tag)}
                              className="shrink-0 rounded bg-emerald-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-35"
                              title="名前を保存"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              disabled={mutating}
                              onClick={() => handleDeleteSidebarTag(tag)}
                              className="shrink-0 rounded p-1 text-rose-400 hover:bg-rose-500/20 hover:text-rose-300 disabled:opacity-35"
                              title={`「${tag.name}」を削除`}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex max-h-56 flex-wrap gap-1.5 overflow-y-auto pr-1">
                      {displayedTags.map((tag) => {
                        const mode = tagFilters[tag.id];
                        let modeStyle =
                          'border-slate-800 bg-slate-950/70 text-slate-300 hover:border-slate-700';
                        let badge = '';
                        if (mode === 'and') {
                          modeStyle =
                            'border-emerald-500 bg-emerald-500/20 text-emerald-200 font-semibold';
                          badge = 'AND';
                        } else if (mode === 'or') {
                          modeStyle =
                            'border-sky-500 bg-sky-500/20 text-sky-200 font-semibold';
                          badge = 'OR';
                        } else if (mode === 'not') {
                          modeStyle =
                            'border-rose-500 bg-rose-500/20 text-rose-200 font-semibold line-through';
                          badge = 'NOT';
                        }

                        return (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => cycleTagFilter(tag.id)}
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition ${modeStyle}`}
                          >
                            {tag.kind === 'custom' && (
                              <span
                                className="h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: tag.color }}
                              />
                            )}
                            <span>{tag.name}</span>
                            {tag.childIds.length > 0 && (
                              <span
                                className="rounded bg-sky-500/20 px-1 text-[9px] text-sky-300"
                                title={`子タグ ${tag.childIds.length} 個を含むメタタグ`}
                              >
                                子{tag.childIds.length}
                              </span>
                            )}
                            <span className="text-[10px] text-slate-500">
                              {tag.modCount ?? 0}
                            </span>
                            {badge && (
                              <span className="ml-0.5 rounded bg-black/40 px-1 text-[9px] font-bold no-underline">
                                {badge}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Status & Side */}
                <div className="space-y-3 border-t border-slate-800 pt-3">
                  <div className="space-y-1.5">
                    <span className="text-xs font-semibold text-slate-300">
                      採用ステータス
                    </span>
                    <div className="grid grid-cols-4 gap-1 text-[11px]">
                      {(
                        [
                          { v: 'all', label: 'すべて' },
                          { v: 'adopted', label: '採用' },
                          { v: 'candidate', label: '候補' },
                          { v: 'deprecated', label: '非推奨' },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.v}
                          type="button"
                          onClick={() => setStatusFilter(opt.v)}
                          className={`rounded-md border py-1 font-medium transition ${
                            statusFilter === opt.v
                              ? 'border-emerald-500 bg-emerald-500/20 text-white'
                              : 'border-slate-800 bg-slate-950/70 text-slate-400 hover:text-white'
                          }`}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        Client要件
                      </label>
                      <select
                        value={clientFilter}
                        onChange={(e) => setClientFilter(e.target.value as ModSide | 'all')}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:outline-none"
                      >
                        <option value="all">すべて</option>
                        <option value="required">必須</option>
                        <option value="optional">任意</option>
                        <option value="unsupported">非対応</option>
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-[11px] text-slate-400">
                        Server要件
                      </label>
                      <select
                        value={serverFilter}
                        onChange={(e) => setServerFilter(e.target.value as ModSide | 'all')}
                        className="w-full rounded-lg border border-slate-800 bg-slate-950 px-2 py-1 text-xs text-slate-200 focus:outline-none"
                      >
                        <option value="all">すべて</option>
                        <option value="required">必須</option>
                        <option value="optional">任意</option>
                        <option value="unsupported">非対応</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            {/* Right Main Search Results */}
            <section className="flex-1 min-w-0 space-y-4">
              {/* Top Search & Sort Bar */}
              <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-slate-800 bg-[#111827] p-3">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="MOD名、日本語通称、メモ、Slugで検索..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">
                    <strong className="text-white">{mods.length}</strong> / {totalCount} 件
                  </span>

                  <select
                    value={sort}
                    onChange={(e) => setSort(e.target.value as ModSort)}
                    className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
                  >
                    <option value="updated_desc">MOD更新日順</option>
                    <option value="downloads_desc">DL数順</option>
                    <option value="name_asc">名前順 (A-Z)</option>
                    <option value="created_desc">DB登録が新しい順</option>
                  </select>

                  <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
                    <button
                      type="button"
                      onClick={() => setViewMode('card')}
                      className={`rounded-md p-1.5 ${
                        viewMode === 'card'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="カード表示"
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('table')}
                      className={`rounded-md p-1.5 ${
                        viewMode === 'table'
                          ? 'bg-slate-800 text-white'
                          : 'text-slate-400 hover:text-white'
                      }`}
                      title="テーブル表示"
                    >
                      <List className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Results Area */}
              {loadingMods && mods.length === 0 ? (
                <div className="flex items-center justify-center py-20 text-slate-400">
                  <Loader2 className="mr-2 h-6 w-6 animate-spin text-emerald-400" />
                  データベースを読み込み中...
                </div>
              ) : totalCount === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-700 bg-[#111827]/70 p-10 text-center space-y-4">
                  <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-400">
                    <Database className="h-7 w-7" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-white">
                      まだMODが登録されていません
                    </h3>
                    <p className="mx-auto max-w-md text-xs leading-relaxed text-slate-400">
                      「外部検索・選択追加」タブから Modrinth / CurseForge をブラウズして欲しいMODを選ぶか、上の入力欄にURLを貼って登録できます。
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setActiveTab('discover')}
                      className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-emerald-500"
                    >
                      <Globe className="h-4 w-4" />
                      外部検索からMODを選ぶ
                    </button>
                    <button
                      type="button"
                      onClick={handleSeedSamples}
                      disabled={seedingSamples}
                      className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                    >
                      {seedingSamples ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 text-amber-400" />
                      )}
                      定番MODサンプル6件を登録してみる
                    </button>
                  </div>
                </div>
              ) : mods.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center space-y-3">
                  <p className="text-sm text-slate-400">
                    指定した条件に一致するMODがありません。
                  </p>
                  <button
                    type="button"
                    onClick={clearAllFilters}
                    className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
                  >
                    フィルタをすべてリセット
                  </button>
                </div>
              ) : viewMode === 'card' ? (
                <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
                  {mods.map((mod) => {
                    const releaseVers = mod.mcVersions.filter(isReleaseMcVersionClient);
                    const displayVers = (releaseVers.length > 0 ? releaseVers : mod.mcVersions).slice(
                      0,
                      4
                    );
                    const extraVerCount =
                      (releaseVers.length > 0 ? releaseVers.length : mod.mcVersions.length) -
                      displayVers.length;

                    return (
                      <div
                        key={mod.id}
                        onClick={() => setDetailModId(mod.id)}
                        className="group relative flex cursor-pointer flex-col justify-between rounded-xl border border-slate-800 bg-[#111827] p-4 transition hover:border-emerald-500/50 hover:bg-[#141d2e]"
                      >
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            {mod.iconUrl ? (
                              <img
                                src={mod.iconUrl}
                                alt={mod.name}
                                className="h-12 w-12 shrink-0 rounded-lg border border-slate-700 bg-slate-900 object-cover"
                              />
                            ) : (
                              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-xs font-bold text-slate-400">
                                MOD
                              </div>
                            )}

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <h3 className="truncate text-sm font-bold text-white group-hover:text-emerald-300">
                                    {mod.name}
                                  </h3>
                                  {mod.jaName && (
                                    <div className="truncate text-xs font-medium text-emerald-400/90">
                                      {mod.jaName}
                                    </div>
                                  )}
                                </div>
                                <StatusBadge status={mod.status} />
                              </div>

                              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                                <span>DL {formatDownloads(mod.downloads)}</span>
                                {mod.modrinthId && (
                                  <a
                                    href={`https://modrinth.com/mod/${mod.modrinthSlug ?? mod.modrinthId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 hover:bg-emerald-500/25"
                                  >
                                    MR <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                )}
                                {mod.curseforgeId && (
                                  <a
                                    href={`https://www.curseforge.com/minecraft/mc-mods/${mod.curseforgeSlug ?? mod.curseforgeId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex items-center gap-0.5 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-orange-300 hover:bg-orange-500/25"
                                  >
                                    CF <ExternalLink className="h-2.5 w-2.5" />
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>

                          <p className="line-clamp-2 text-xs leading-relaxed text-slate-300">
                            {mod.note ? (
                              <span className="text-amber-200/90">📝 {mod.note}</span>
                            ) : (
                              mod.summary
                            )}
                          </p>

                          {/* Loaders & MC Versions */}
                          <div className="flex flex-wrap items-center gap-1">
                            {mod.loaders.map((ld) => (
                              <LoaderBadge key={ld} loader={ld} />
                            ))}
                            {displayVers.map((v) => (
                              <span
                                key={v}
                                className="rounded bg-slate-800/90 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                              >
                                {v}
                              </span>
                            ))}
                            {extraVerCount > 0 && (
                              <span className="text-[10px] text-slate-500">
                                +{extraVerCount}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Tags + Inline Tag Picker */}
                        <div className="mt-3 flex flex-wrap items-center gap-1 border-t border-slate-800/80 pt-2.5">
                          {mod.tags
                            .filter((t) => t.kind === 'custom')
                            .map((tag) => (
                              <TagPill key={tag.id} tag={tag} compact />
                            ))}
                          {mod.tags
                            .filter((t) => t.kind === 'official')
                            .slice(0, 2)
                            .map((tag) => (
                              <TagPill key={tag.id} tag={tag} compact />
                            ))}

                          <div
                            className="relative"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setOpenInlineTagModId((prev) =>
                                  prev === mod.id ? null : mod.id
                                )
                              }
                              className="inline-flex items-center gap-0.5 rounded border border-dashed border-slate-700 px-1.5 py-0.5 text-[11px] text-slate-400 hover:border-emerald-500 hover:text-emerald-300"
                            >
                              <Plus className="h-3 w-3" />
                              タグ
                            </button>

                            {openInlineTagModId === mod.id && (
                              <div
                                ref={inlinePopoverRef}
                                className="absolute bottom-7 left-0 z-30 w-56 rounded-xl border border-slate-700 bg-[#0f1623] p-2.5 shadow-2xl"
                              >
                                <div className="mb-1.5 text-[11px] font-semibold text-slate-300">
                                  カスタムタグを付け外し
                                </div>
                                <div className="flex max-h-44 flex-wrap gap-1 overflow-y-auto">
                                  {customTags.map((ct) => {
                                    const has = mod.tags.some((t) => t.id === ct.id);
                                    return (
                                      <button
                                        key={ct.id}
                                        type="button"
                                        onClick={() => handleInlineToggleTag(mod, ct.id)}
                                        className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] ${
                                          has
                                            ? 'border-emerald-400 bg-emerald-500/20 text-white'
                                            : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-white'
                                        }`}
                                      >
                                        <span
                                          className="h-1.5 w-1.5 rounded-full"
                                          style={{ backgroundColor: ct.color }}
                                        />
                                        {ct.name}
                                        {has && <Check className="h-2.5 w-2.5" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Table View */
                <div className="overflow-x-auto rounded-xl border border-slate-800 bg-[#111827]">
                  <table className="w-full text-left text-xs">
                    <thead className="border-b border-slate-800 bg-slate-950/70 text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-semibold">MOD</th>
                        <th className="px-3 py-3 font-semibold">状態</th>
                        <th className="px-3 py-3 font-semibold">ローダー</th>
                        <th className="px-3 py-3 font-semibold">主なMC版</th>
                        <th className="px-3 py-3 font-semibold">カスタムタグ</th>
                        <th className="px-3 py-3 font-semibold">動作</th>
                        <th className="px-3 py-3 font-semibold text-right">DL</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {mods.map((mod) => {
                        const releaseVers = mod.mcVersions.filter(
                          isReleaseMcVersionClient
                        );
                        const topVers = (
                          releaseVers.length > 0 ? releaseVers : mod.mcVersions
                        ).slice(0, 3);
                        return (
                          <tr
                            key={mod.id}
                            onClick={() => setDetailModId(mod.id)}
                            className="cursor-pointer hover:bg-slate-800/40"
                          >
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2.5">
                                {mod.iconUrl ? (
                                  <img
                                    src={mod.iconUrl}
                                    alt={mod.name}
                                    className="h-8 w-8 rounded border border-slate-700 object-cover"
                                  />
                                ) : (
                                  <div className="flex h-8 w-8 items-center justify-center rounded border border-slate-700 bg-slate-800 text-[10px]">
                                    MOD
                                  </div>
                                )}
                                <div>
                                  <div className="font-bold text-white">
                                    {mod.name}
                                  </div>
                                  {mod.jaName && (
                                    <div className="text-[11px] text-emerald-400">
                                      {mod.jaName}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-3 py-3">
                              <StatusBadge status={mod.status} />
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-1">
                                {mod.loaders.map((ld) => (
                                  <LoaderBadge key={ld} loader={ld} />
                                ))}
                              </div>
                            </td>
                            <td className="px-3 py-3 font-mono text-[11px] text-slate-300">
                              {topVers.join(', ')}
                            </td>
                            <td className="px-3 py-3">
                              <div className="flex flex-wrap gap-1">
                                {mod.tags
                                  .filter((t) => t.kind === 'custom')
                                  .map((t) => (
                                    <TagPill key={t.id} tag={t} compact />
                                  ))}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-[11px] text-slate-400">
                              C:{SIDE_LABELS[mod.clientSide]} / S:
                              {SIDE_LABELS[mod.serverSide]}
                            </td>
                            <td className="px-3 py-3 text-right font-mono text-slate-300">
                              {formatDownloads(mod.downloads)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      <ModDetailDrawer
        modId={detailModId}
        allTags={allTags}
        onClose={() => setDetailModId(null)}
        onUpdated={fetchMods}
        onDeleted={fetchMods}
        onSelectMod={(id) => setDetailModId(id)}
        onTagCreated={(tag) =>
          setAllTags((prev) =>
            prev.some((t) => t.id === tag.id) ? prev : [...prev, tag]
          )
        }
      />

      <TagHierarchyModal
        open={tagHierarchyOpen}
        tags={allTags}
        onClose={() => setTagHierarchyOpen(false)}
        onTagsChanged={(nextTags) => setAllTags(nextTags)}
        onRefreshAll={fetchMods}
      />

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={() => {
          fetchMods();
          void refreshSyncConfig();
        }}
      />
    </div>
  );
}
