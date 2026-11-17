'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckSquare,
  ExternalLink,
  Loader2,
  Plus,
  Search,
  Square,
} from 'lucide-react';
import { LoaderBadge, formatDownloads } from '@/components/ModBadges';
import type { DiscoverModItem, ModTag } from '@/types/mod';

const PRESET_VERSIONS = [
  '1.21.4',
  '1.21.1',
  '1.20.4',
  '1.20.1',
  '1.19.2',
  '1.18.2',
  '1.16.5',
  '1.12.2',
];

const LOADERS = ['fabric', 'neoforge', 'forge', 'quilt'];

interface DiscoverPanelProps {
  allTags: ModTag[];
  onImported: () => void;
  onOpenSettings: () => void;
}

export function DiscoverPanel({
  allTags,
  onImported,
  onOpenSettings,
}: DiscoverPanelProps) {
  const [q, setQ] = useState('');
  const [source, setSource] = useState<'all' | 'modrinth' | 'curseforge'>('all');
  const [mcVersion, setMcVersion] = useState('');
  const [loader, setLoader] = useState('');
  const [sort, setSort] = useState<'downloads' | 'relevance' | 'updated'>('downloads');

  const [items, setItems] = useState<DiscoverModItem[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [importingKeys, setImportingKeys] = useState<Set<string>>(new Set());
  const [bulkTagIds, setBulkTagIds] = useState<string[]>([]);
  const [autoDependencies, setAutoDependencies] = useState(true);
  const [excludeInDb, setExcludeInDb] = useState(false);
  const [excludedInDbCount, setExcludedInDbCount] = useState(0);
  const [bulkImporting, setBulkImporting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const itemKey = (item: DiscoverModItem) => `${item.source}:${item.externalId}`;

  const visibleItems = excludeInDb
    ? items.filter((it) => !it.alreadyInDb)
    : items;

  const runSearch = useCallback(async () => {
    setLoading(true);
    setError(null);
    setFeedback(null);
    try {
      const qs = new URLSearchParams({
        source,
        q,
        mcVersion,
        loader,
        sort,
        limit: '24',
        excludeInDb: excludeInDb ? '1' : '0',
      });
      const res = await fetch(`/api/discover?${qs.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '検索に失敗しました');
      setItems(data.items ?? []);
      setWarnings(data.warnings ?? []);
      setExcludedInDbCount(data.excludedInDbCount ?? 0);
      setSelectedKeys(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : '検索に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [source, q, mcVersion, loader, sort, excludeInDb]);

  useEffect(() => {
    runSearch();
  }, [runSearch]);

  function toggleSelect(item: DiscoverModItem) {
    const key = itemKey(item);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function markItemsAsImported(
    importedKeys: Set<string>,
    linkedDeps: Array<{ name: string; newlyImported: boolean }>
  ) {
    const depNameSet = new Set(
      linkedDeps.map((d) => d.name.replace(/\s+/g, '').toLowerCase())
    );
    const newlyMarkedKeys = new Set<string>();
    for (const it of items) {
      const k = itemKey(it);
      const nameMatched = depNameSet.has(
        it.name.replace(/\s+/g, '').toLowerCase()
      );
      if (!it.alreadyInDb && (importedKeys.has(k) || nameMatched)) {
        newlyMarkedKeys.add(k);
      }
    }

    setItems((prev) =>
      prev.map((it) => {
        const k = itemKey(it);
        const nameMatched = depNameSet.has(
          it.name.replace(/\s+/g, '').toLowerCase()
        );
        if (importedKeys.has(k) || nameMatched) {
          return { ...it, alreadyInDb: true };
        }
        return it;
      })
    );

    if (excludeInDb && newlyMarkedKeys.size > 0) {
      setExcludedInDbCount((prev) => prev + newlyMarkedKeys.size);
    }
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const k of importedKeys) next.delete(k);
      for (const k of newlyMarkedKeys) next.delete(k);
      return next;
    });
  }

  async function importSingle(item: DiscoverModItem) {
    const key = itemKey(item);
    setImportingKeys((prev) => new Set(prev).add(key));
    setFeedback(null);
    setError(null);
    try {
      const res = await fetch('/api/mods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: item.source,
          idOrSlug: item.externalId,
          autoDependencies,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '登録に失敗しました');

      const linked: Array<{ name: string; newlyImported: boolean }> =
        Array.isArray(data.linkedDependencies) ? data.linkedDependencies : [];
      markItemsAsImported(new Set([key]), linked);
      const depText =
        linked.length > 0
          ? `（前提MOD ${linked.length}件を自動連携: ${linked.map((d) => d.name).join(', ')}）`
          : '';
      setFeedback(`「${item.name}」をマイDBに登録しました${depText}`);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : '登録に失敗しました');
    } finally {
      setImportingKeys((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  async function importSelectedBulk() {
    const targets = visibleItems.filter((it) => selectedKeys.has(itemKey(it)));
    if (targets.length === 0) return;

    setBulkImporting(true);
    setError(null);
    setFeedback(null);

    try {
      const res = await fetch('/api/mods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: targets.map((t) => ({ source: t.source, idOrSlug: t.externalId })),
          tagIds: bulkTagIds,
          autoDependencies,
        }),
      });
      const data = await res.json();
      if (!res.ok && (!data.imported || data.imported.length === 0)) {
        throw new Error(data.error || '一括登録に失敗しました');
      }

      const importedCount = data.imported?.length ?? 0;
      const errorCount = data.errors?.length ?? 0;
      const linked: Array<{ name: string; newlyImported: boolean }> =
        Array.isArray(data.linkedDependencies) ? data.linkedDependencies : [];
      const depText =
        linked.length > 0
          ? ` / 前提MOD ${linked.length}件連携 (${linked.map((d) => d.name).join(', ')})`
          : '';

      markItemsAsImported(
        new Set(targets.map((t) => itemKey(t))),
        linked
      );
      setSelectedKeys(new Set());
      setFeedback(
        `${importedCount} 件のMODをマイDBに追加しました${depText}${
          errorCount > 0 ? `（${errorCount} 件失敗）` : ''
        }`
      );
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : '一括登録に失敗しました');
    } finally {
      setBulkImporting(false);
    }
  }

  const customTags = allTags.filter((t) => t.kind === 'custom');

  return (
    <div className="space-y-4 pb-24">
      <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-white">
              外部API 横断検索・選択式インポート
            </h2>
            <p className="text-xs text-slate-400">
              Modrinth / CurseForge から検索・人気順閲覧し、チェックを入れて欲しいMODだけを自分のDBに取り込めます。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label
              title="マイDBに既に登録されているMODを検索結果から除外します"
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
                excludeInDb
                  ? 'border-sky-500/60 bg-sky-500/15 text-sky-200'
                  : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-sky-500/50'
              }`}
            >
              <input
                type="checkbox"
                checked={excludeInDb}
                onChange={(e) => setExcludeInDb(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 accent-sky-500"
              />
              DB登録済みを除外
              {excludeInDb && excludedInDbCount > 0 && (
                <span className="rounded-full bg-sky-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-sky-200">
                  {excludedInDbCount}件除外
                </span>
              )}
            </label>
            <label
              title="インポート時に必須の前提MODも自動検出してDBへ登録・紐付けします"
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-200 hover:border-emerald-500/60"
            >
              <input
                type="checkbox"
                checked={autoDependencies}
                onChange={(e) => setAutoDependencies(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 accent-emerald-500"
              />
              前提MODも自動登録
            </label>
            <div className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-900 p-1 text-xs">
              {(['all', 'modrinth', 'curseforge'] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setSource(s)}
                  className={`rounded-md px-3 py-1 font-medium transition ${
                    source === s
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s === 'all' ? '両方' : s === 'modrinth' ? 'Modrinth' : 'CurseForge'}
                </button>
              ))}
            </div>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            runSearch();
          }}
          className="grid grid-cols-1 gap-2.5 md:grid-cols-12"
        >
          <div className="relative md:col-span-5">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <input
              type="text"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="キーワード検索（空欄で人気順表示）例: create, optimization, jei"
              className="w-full rounded-lg border border-slate-700 bg-slate-950 py-2 pl-9 pr-3 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <select
              value={mcVersion}
              onChange={(e) => setMcVersion(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="">MCバージョン: すべて</option>
              {PRESET_VERSIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={loader}
              onChange={(e) => setLoader(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="">ローダー: すべて</option>
              {LOADERS.map((ld) => (
                <option key={ld} value={ld}>
                  {ld}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <select
              value={sort}
              onChange={(e) =>
                setSort(e.target.value as 'downloads' | 'relevance' | 'updated')
              }
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
            >
              <option value="downloads">DL数順</option>
              <option value="relevance">関連度順</option>
              <option value="updated">更新日順</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 md:col-span-1"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : '検索'}
          </button>
        </form>
      </div>

      {warnings.map((w, idx) => (
        <div
          key={idx}
          className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/35 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" />
            {w}
          </span>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded border border-amber-400/40 px-2.5 py-1 font-medium hover:bg-amber-500/20"
          >
            API・設定を開く
          </button>
        </div>
      ))}

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
          {error}
        </div>
      )}

      {feedback && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200">
          {feedback}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20 text-slate-400">
          <Loader2 className="mr-2 h-6 w-6 animate-spin text-emerald-400" />
          外部APIから検索中...
        </div>
      ) : visibleItems.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 py-16 text-center text-sm text-slate-500">
          {excludeInDb && excludedInDbCount > 0
            ? `条件に一致する未登録MODはありませんでした（DB登録済み ${excludedInDbCount} 件を除外中）。`
            : '条件に一致するMODが見つかりませんでした。検索条件を変えてお試しください。'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {visibleItems.map((item) => {
            const key = itemKey(item);
            const selected = selectedKeys.has(key);
            const isImporting = importingKeys.has(key);
            return (
              <div
                key={key}
                className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                  selected
                    ? 'border-emerald-500/70 bg-emerald-950/20'
                    : 'border-slate-800 bg-[#111827] hover:border-slate-700'
                }`}
              >
                <div className="flex items-start gap-3">
                  <button
                    type="button"
                    onClick={() => toggleSelect(item)}
                    className="mt-1 shrink-0 text-slate-400 hover:text-emerald-400"
                    title="選択を切り替え"
                  >
                    {selected ? (
                      <CheckSquare className="h-5 w-5 text-emerald-400" />
                    ) : (
                      <Square className="h-5 w-5" />
                    )}
                  </button>

                  {item.iconUrl ? (
                    <img
                      src={item.iconUrl}
                      alt={item.name}
                      className="h-12 w-12 shrink-0 rounded-lg border border-slate-700 bg-slate-900 object-cover"
                    />
                  ) : (
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-xs font-bold text-slate-400">
                      MOD
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate text-sm font-bold text-white">
                        {item.name}
                      </h3>
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${
                          item.source === 'modrinth'
                            ? 'border-emerald-500/35 bg-emerald-500/15 text-emerald-300'
                            : 'border-orange-500/35 bg-orange-500/15 text-orange-300'
                        }`}
                      >
                        {item.source}
                      </span>
                      {item.alreadyInDb && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                          <Check className="h-3 w-3" />
                          DB登録済み
                        </span>
                      )}
                    </div>

                    <p className="mt-0.5 text-xs text-slate-400">
                      by {item.author ?? '不明'} ・ DL: {formatDownloads(item.downloads)}
                    </p>

                    <p className="mt-1.5 line-clamp-2 text-xs text-slate-300">
                      {item.summary}
                    </p>
                  </div>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800/80 pt-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {item.loaders.slice(0, 4).map((ld) => (
                      <LoaderBadge key={ld} loader={ld} />
                    ))}
                    {item.mcVersions.slice(0, 3).map((v) => (
                      <span
                        key={v}
                        className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-slate-300"
                      >
                        {v}
                      </span>
                    ))}
                    {item.mcVersions.length > 3 && (
                      <span className="text-[10px] text-slate-500">
                        +{item.mcVersions.length - 3}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <a
                      href={item.projectUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-lg border border-slate-700 p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
                      title="配布ページを開く"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={() => importSingle(item)}
                      disabled={isImporting}
                      className={`inline-flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50 ${
                        item.alreadyInDb
                          ? 'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700'
                          : 'bg-emerald-600 text-white hover:bg-emerald-500'
                      }`}
                    >
                      {isImporting ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Plus className="h-3.5 w-3.5" />
                      )}
                      {item.alreadyInDb ? '再同期/更新' : 'DBに追加'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selectedKeys.size > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 flex w-[95%] max-w-4xl -translate-x-1/2 flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/40 bg-[#111827]/95 px-5 py-3 shadow-2xl backdrop-blur">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-300">
              {selectedKeys.size} 件選択中
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-400">初期タグ:</span>
              {customTags.slice(0, 6).map((tag) => {
                const active = bulkTagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() =>
                      setBulkTagIds((prev) =>
                        prev.includes(tag.id)
                          ? prev.filter((id) => id !== tag.id)
                          : [...prev, tag.id]
                      )
                    }
                    className={`rounded border px-2 py-0.5 text-[11px] transition ${
                      active
                        ? 'border-emerald-400 bg-emerald-500/25 text-white'
                        : 'border-slate-700 bg-slate-900 text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-slate-300 hover:border-slate-600">
              <input
                type="checkbox"
                checked={autoDependencies}
                onChange={(e) => setAutoDependencies(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-600 bg-slate-950 accent-emerald-500"
              />
              前提MODも自動追加
            </label>
            <button
              type="button"
              onClick={() => setSelectedKeys(new Set())}
              className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
            >
              選択解除
            </button>
            <button
              type="button"
              onClick={importSelectedBulk}
              disabled={bulkImporting}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
            >
              {bulkImporting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              選択した {selectedKeys.size} 件をまとめて追加
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
