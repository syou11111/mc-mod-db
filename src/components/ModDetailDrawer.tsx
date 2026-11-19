'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowRightLeft,
  Check,
  ExternalLink,
  Layers,
  Link2,
  Loader2,
  PackageSearch,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import {
  LOADER_LABELS,
  LoaderBadge,
  SIDE_LABELS,
  TAG_PALETTE,
  formatDownloads,
  formatLinkedDependenciesText,
  isReleaseMcVersionClient,
} from '@/components/ModBadges';
import type {
  ModPreset,
  ModRecord,
  ModRelationType,
  ModStatus,
  ModTag,
  PresetRequirement,
} from '@/types/mod';

interface ModDetailDrawerProps {
  modId: string | null;
  allTags: ModTag[];
  onClose: () => void;
  onUpdated: () => void;
  onDeleted: () => void;
  onTagCreated: (tag: ModTag) => void;
  onSelectMod?: (modId: string) => void;
}

export function ModDetailDrawer({
  modId,
  allTags,
  onClose,
  onUpdated,
  onDeleted,
  onTagCreated,
  onSelectMod,
}: ModDetailDrawerProps) {
  const [mod, setMod] = useState<ModRecord | null>(null);
  const [allModsList, setAllModsList] = useState<ModRecord[]>([]);
  const [presetsList, setPresetsList] = useState<ModPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [merging, setMerging] = useState(false);
  const [relBusy, setRelBusy] = useState(false);
  const [presetBusy, setPresetBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [jaName, setJaName] = useState('');
  const [status, setStatus] = useState<ModStatus>('candidate');
  const [note, setNote] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [mergeUrl, setMergeUrl] = useState('');
  const [releaseOnly, setReleaseOnly] = useState(true);

  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_PALETTE[0]);

  // Related MODs form
  const [relType, setRelType] = useState<ModRelationType>('dependency');
  const [relTargetId, setRelTargetId] = useState('');
  const [relNote, setRelNote] = useState('');

  // Preset add form
  const [targetPresetId, setTargetPresetId] = useState('');
  const [targetPresetReq, setTargetPresetReq] =
    useState<PresetRequirement>('required');

  useEffect(() => {
    if (!modId) {
      setMod(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    setNotice(null);

    Promise.all([
      fetch(`/api/mods/${modId}`).then((r) => r.json()),
      fetch('/api/mods').then((r) => r.json()),
      fetch('/api/presets').then((r) => r.json()),
    ])
      .then(([modData, allData, presetData]) => {
        if (cancelled) return;
        if (modData.error) {
          setError(modData.error);
          return;
        }
        const m = modData.mod as ModRecord;
        setMod(m);
        setJaName(m.jaName);
        setStatus(m.status);
        setNote(m.note);
        setSelectedTagIds(m.tags.map((t) => t.id));
        setAllModsList(allData.mods ?? []);
        const pList = (presetData.presets ?? []) as ModPreset[];
        setPresetsList(pList);
        if (pList.length > 0) {
          setTargetPresetId((prev) =>
            prev && pList.some((p) => p.id === prev) ? prev : pList[0].id
          );
        }
      })
      .catch(() => {
        if (!cancelled) setError('MOD詳細の読み込みに失敗しました');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [modId]);

  const versionMatrix = useMemo(() => {
    const versions = mod?.versions ?? [];
    const filtered = releaseOnly
      ? versions.filter((v) => isReleaseMcVersionClient(v.mcVersion))
      : versions;

    const loadersSet = new Set<string>();
    const byMc = new Map<
      string,
      Map<string, { versionNumber: string; source: string; releaseType: string }>
    >();

    for (const v of filtered) {
      loadersSet.add(v.loader);
      if (!byMc.has(v.mcVersion)) {
        byMc.set(v.mcVersion, new Map());
      }
      const cellMap = byMc.get(v.mcVersion)!;
      const existing = cellMap.get(v.loader);
      if (!existing || (existing.releaseType !== 'release' && v.releaseType === 'release')) {
        cellMap.set(v.loader, {
          versionNumber: v.versionNumber,
          source: v.source,
          releaseType: v.releaseType,
        });
      }
    }

    return {
      loaders: Array.from(loadersSet).sort(),
      rows: Array.from(byMc.entries()),
    };
  }, [mod, releaseOnly]);

  if (!modId) return null;

  const customTags = allTags.filter((t) => t.kind === 'custom');
  const officialTags = allTags.filter((t) => t.kind === 'official');

  async function handleSaveMeta(nextTagIds = selectedTagIds) {
    if (!mod) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/mods/${mod.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jaName,
          status,
          note,
          tagIds: nextTagIds,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '保存に失敗しました');
      setMod(data.mod);
      setNotice('変更を保存しました');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleTag(tagId: string) {
    const next = selectedTagIds.includes(tagId)
      ? selectedTagIds.filter((id) => id !== tagId)
      : [...selectedTagIds, tagId];
    setSelectedTagIds(next);
    await handleSaveMeta(next);
  }

  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setError(null);
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'タグ作成に失敗しました');
      const created = data.tag as ModTag;
      onTagCreated(created);
      setNewTagName('');
      const next = selectedTagIds.includes(created.id)
        ? selectedTagIds
        : [...selectedTagIds, created.id];
      setSelectedTagIds(next);
      await handleSaveMeta(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグ作成に失敗しました');
    }
  }

  async function handleSync() {
    if (!mod) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/mods/${mod.id}/sync`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '再同期に失敗しました');
      setMod(data.mod);
      setSelectedTagIds((data.mod as ModRecord).tags.map((t) => t.id));
      setNotice('最新バージョン・メタデータを同期しました');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '再同期に失敗しました');
    } finally {
      setSyncing(false);
    }
  }

  async function handleMerge(e: React.FormEvent) {
    e.preventDefault();
    if (!mod || !mergeUrl.trim()) return;
    setMerging(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/mods/${mod.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ linkExternalUrl: mergeUrl.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '名寄せ統合に失敗しました');
      setMod(data.mod);
      setSelectedTagIds((data.mod as ModRecord).tags.map((t) => t.id));
      setMergeUrl('');
      setNotice('別プラットフォームの情報をこのMODに統合しました');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '名寄せ統合に失敗しました');
    } finally {
      setMerging(false);
    }
  }

  async function handleDelete() {
    if (!mod) return;
    if (!confirm(`「${mod.name}」をデータベースから削除しますか？`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/mods/${mod.id}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '削除に失敗しました');
      }
      onDeleted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '削除に失敗しました');
    } finally {
      setDeleting(false);
    }
  }

  async function handleAddRelation(e: React.FormEvent) {
    e.preventDefault();
    if (!mod || !relTargetId) return;
    setRelBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/mods/${mod.id}/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          relatedModId: relTargetId,
          relationType: relType,
          note: relNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '紐付けに失敗しました');
      setMod(data.mod);
      setRelTargetId('');
      setRelNote('');
      setNotice('関連MODを紐付けました');
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '紐付けに失敗しました');
    } finally {
      setRelBusy(false);
    }
  }

  async function handleRemoveRelation(
    relatedModId: string,
    relationType: ModRelationType
  ) {
    if (!mod) return;
    setRelBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/mods/${mod.id}/relations`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ relatedModId, relationType }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '解除に失敗しました');
      setMod(data.mod);
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '解除に失敗しました');
    } finally {
      setRelBusy(false);
    }
  }

  async function handleAutoFetchDependencies() {
    if (!mod) return;
    setRelBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/mods/${mod.id}/relations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ autoFetchDependencies: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '前提MODの検出に失敗しました');
      setMod(data.mod);
      const linked = Array.isArray(data.linkedMods) ? data.linkedMods : [];
      const summary = formatLinkedDependenciesText(linked);
      setNotice(
        summary
          ? `必須の${summary}`
          : 'API上に必須の前提MODは見当たりませんでした'
      );
      onUpdated();
    } catch (err) {
      setError(err instanceof Error ? err.message : '前提MODの検出に失敗しました');
    } finally {
      setRelBusy(false);
    }
  }

  async function handleAddToPreset() {
    if (!mod || !targetPresetId) return;
    setPresetBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/presets/${targetPresetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upsertMod: { modId: mod.id, requirement: targetPresetReq },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'プリセットへの追加に失敗しました');
      setPresetsList((prev) =>
        prev.map((p) => (p.id === targetPresetId ? data.preset : p))
      );
      setNotice('プリセットに追加しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '追加に失敗しました');
    } finally {
      setPresetBusy(false);
    }
  }

  async function handleRemoveFromPreset(presetId: string) {
    if (!mod) return;
    setPresetBusy(true);
    try {
      const res = await fetch(`/api/presets/${presetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeModId: mod.id }),
      });
      const data = await res.json();
      if (res.ok) {
        setPresetsList((prev) =>
          prev.map((p) => (p.id === presetId ? data.preset : p))
        );
      }
    } finally {
      setPresetBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/65 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col border-l border-slate-800 bg-[#0f1623] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3 min-w-0">
            {mod?.iconUrl ? (
              <img
                src={mod.iconUrl}
                alt={mod.name}
                className="h-11 w-11 shrink-0 rounded-lg border border-slate-700 bg-slate-900 object-cover"
              />
            ) : (
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-sm font-bold text-slate-400">
                MOD
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-white">
                {mod?.name ?? '読み込み中...'}
              </h2>
              {mod && (
                <p className="truncate text-xs text-slate-400">
                  by {mod.author ?? '不明'} ・ DL: {formatDownloads(mod.downloads)} ・
                  Client: {SIDE_LABELS[mod.clientSide]} / Server:{' '}
                  {SIDE_LABELS[mod.serverSide]}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {mod && (
              <>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={syncing}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-50"
                  title="外部APIから最新バージョンを再取得"
                >
                  {syncing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  同期
                </button>
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-900/60 bg-rose-950/40 px-2.5 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-900/50 disabled:opacity-50"
                  title="DBから削除"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center py-12 text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              読み込み中...
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
              {error}
            </div>
          )}

          {notice && (
            <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2.5 text-sm text-emerald-200">
              {notice}
            </div>
          )}

          {mod && !loading && (
            <>
              <div className="space-y-2">
                <p className="text-sm leading-relaxed text-slate-300">
                  {mod.summary || '概要なし'}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  {mod.modrinthId && (
                    <a
                      href={`https://modrinth.com/mod/${mod.modrinthSlug ?? mod.modrinthId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20"
                    >
                      Modrinth で開く
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  {mod.curseforgeId && (
                    <a
                      href={`https://www.curseforge.com/minecraft/mc-mods/${mod.curseforgeSlug ?? mod.curseforgeId}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-md border border-orange-500/35 bg-orange-500/10 px-2.5 py-1 text-xs font-medium text-orange-300 hover:bg-orange-500/20"
                    >
                      CurseForge で開く
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              </div>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200">
                    個人メモ・評価・日本語通称
                  </h3>
                  <button
                    type="button"
                    onClick={() => handleSaveMeta()}
                    disabled={saving}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {saving ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    保存する
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">
                      日本語通称 / エイリアス
                    </label>
                    <input
                      type="text"
                      value={jaName}
                      onChange={(e) => setJaName(e.target.value)}
                      placeholder="例: 黄昏の森、一括破壊、軽量化"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-slate-400">
                      採用ステータス
                    </label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as ModStatus)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white focus:border-emerald-500 focus:outline-none"
                    >
                      <option value="adopted">採用（メイン導入）</option>
                      <option value="candidate">候補（検討中）</option>
                      <option value="deprecated">非推奨（競合・保留）</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="mb-1 block text-xs text-slate-400">
                    個人メモ（前提MOD・設定ポイント・日本語化情報など）
                  </label>
                  <textarea
                    rows={3}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="サーバー側にも必要、Irisと併用可、Configで〇〇を無効化推奨 など..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <h3 className="text-sm font-semibold text-slate-200">
                  タグ付け（クリックで即座にON/OFF）
                </h3>

                <div className="space-y-2">
                  <div className="text-xs text-slate-400">カスタムタグ</div>
                  <div className="flex flex-wrap gap-1.5">
                    {customTags.map((tag) => {
                      const active = selectedTagIds.includes(tag.id);
                      return (
                        <button
                          key={tag.id}
                          type="button"
                          onClick={() => handleToggleTag(tag.id)}
                          className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs transition ${
                            active
                              ? 'border-white/40 font-semibold text-white shadow-sm'
                              : 'border-slate-700/80 bg-slate-950/60 text-slate-400 hover:border-slate-600 hover:text-slate-200'
                          }`}
                          style={
                            active
                              ? {
                                  backgroundColor: `${tag.color}33`,
                                  borderColor: tag.color,
                                }
                              : undefined
                          }
                        >
                          <span
                            className="h-2 w-2 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          {tag.name}
                          {active && <Check className="h-3 w-3" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <form onSubmit={handleCreateTag} className="flex flex-wrap items-center gap-2 pt-1">
                  <input
                    type="text"
                    value={newTagName}
                    onChange={(e) => setNewTagName(e.target.value)}
                    placeholder="新しいカスタムタグ名..."
                    className="min-w-[180px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <div className="flex items-center gap-1">
                    {TAG_PALETTE.slice(0, 6).map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setNewTagColor(c)}
                        className={`h-5 w-5 rounded-full border-2 ${
                          newTagColor === c ? 'border-white scale-110' : 'border-transparent'
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                  <button
                    type="submit"
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    作成して付与
                  </button>
                </form>

                {officialTags.length > 0 && (
                  <div className="space-y-1.5 pt-2 border-t border-slate-800/80">
                    <div className="text-xs text-slate-400">公式カテゴリタグ</div>
                    <div className="flex flex-wrap gap-1.5">
                      {officialTags
                        .filter((t) => selectedTagIds.includes(t.id))
                        .map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => handleToggleTag(tag.id)}
                            className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-800/70 px-2 py-0.5 text-[11px] text-slate-300 hover:border-rose-500/50"
                            title="クリックで外す"
                          >
                            {tag.name}
                            <span className="text-slate-500">×</span>
                          </button>
                        ))}
                    </div>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-200">
                    対応 MCバージョン × ローダー マトリクス
                  </h3>
                  <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={releaseOnly}
                      onChange={(e) => setReleaseOnly(e.target.checked)}
                      className="rounded border-slate-600 bg-slate-950 text-emerald-500"
                    />
                    リリース版のみ表示
                  </label>
                </div>

                {versionMatrix.rows.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    表示可能なバージョン情報がありません。
                  </p>
                ) : (
                  <div className="max-h-64 overflow-auto rounded-lg border border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-slate-950 text-slate-400">
                        <tr>
                          <th className="px-3 py-2 font-medium">MC Version</th>
                          {versionMatrix.loaders.map((ld) => (
                            <th key={ld} className="px-3 py-2 font-medium">
                              {LOADER_LABELS[ld] ?? ld}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {versionMatrix.rows.map(([mcVer, cellMap]) => (
                          <tr key={mcVer} className="hover:bg-slate-800/40">
                            <td className="px-3 py-1.5 font-mono font-semibold text-slate-200">
                              {mcVer}
                            </td>
                            {versionMatrix.loaders.map((ld) => {
                              const cell = cellMap.get(ld);
                              return (
                                <td key={ld} className="px-3 py-1.5">
                                  {cell ? (
                                    <span
                                      className="inline-flex items-center gap-1 rounded bg-emerald-500/10 px-1.5 py-0.5 font-mono text-[11px] text-emerald-300"
                                      title={`${cell.versionNumber} (${cell.releaseType})`}
                                    >
                                      {cell.source === 'modrinth' ? 'MR' : 'CF'}
                                      <span className="max-w-[110px] truncate text-slate-300">
                                        {cell.versionNumber}
                                      </span>
                                    </span>
                                  ) : (
                                    <span className="text-slate-600">—</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                    <ArrowRightLeft className="h-4 w-4 text-emerald-400" />
                    関連MOD（前提MOD / ローダー別代替MOD）
                  </h3>
                  <button
                    type="button"
                    onClick={handleAutoFetchDependencies}
                    disabled={relBusy}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 disabled:opacity-50"
                  >
                    {relBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <PackageSearch className="h-3.5 w-3.5" />
                    )}
                    APIから必須の前提MODを自動検出・登録
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <div className="text-xs font-semibold text-amber-300">
                      📦 前提MOD ({mod.dependencies.length})
                    </div>
                    {mod.dependencies.length === 0 ? (
                      <p className="text-[11px] text-slate-500">登録なし</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {mod.dependencies.map((dep) => (
                          <span
                            key={dep.id}
                            className="inline-flex items-center gap-1 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-100"
                          >
                            <button
                              type="button"
                              onClick={() => onSelectMod?.(dep.id)}
                              className="hover:underline"
                            >
                              {dep.name}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveRelation(dep.id, 'dependency')
                              }
                              className="text-amber-300/70 hover:text-white"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-3">
                    <div className="text-xs font-semibold text-sky-300">
                      🔄 ローダー違い・代替MOD ({mod.alternatives.length})
                    </div>
                    {mod.alternatives.length === 0 ? (
                      <p className="text-[11px] text-slate-500">登録なし</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {mod.alternatives.map((alt) => (
                          <span
                            key={alt.id}
                            className="inline-flex items-center gap-1 rounded border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-100"
                          >
                            <button
                              type="button"
                              onClick={() => onSelectMod?.(alt.id)}
                              className="hover:underline"
                            >
                              {alt.name}
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveRelation(alt.id, 'alternative')
                              }
                              className="text-sky-300/70 hover:text-white"
                            >
                              ×
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <form
                  onSubmit={handleAddRelation}
                  className="flex flex-wrap items-center gap-2 pt-1"
                >
                  <select
                    value={relType}
                    onChange={(e) =>
                      setRelType(e.target.value as ModRelationType)
                    }
                    className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="dependency">前提MODとして追加</option>
                    <option value="alternative">代替MODとして紐付け</option>
                  </select>

                  <select
                    value={relTargetId}
                    onChange={(e) => setRelTargetId(e.target.value)}
                    className="min-w-[180px] flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="">DB内のMODを選択...</option>
                    {allModsList
                      .filter((m) => m.id !== mod.id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name} {m.jaName ? `(${m.jaName})` : ''}
                        </option>
                      ))}
                  </select>

                  <button
                    type="submit"
                    disabled={relBusy || !relTargetId}
                    className="inline-flex items-center gap-1 rounded-lg bg-slate-800 border border-slate-700 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    紐付ける
                  </button>
                </form>
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-3">
                <h3 className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                  <Layers className="h-4 w-4 text-purple-400" />
                  プリセットへの登録状況
                </h3>

                {presetsList.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    「プリセット・互換チェック」タブからプリセットを作成すると、ここから追加できます。
                  </p>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-1.5">
                      {presetsList
                        .filter((p) => p.items.some((i) => i.modId === mod.id))
                        .map((p) => {
                          const item = p.items.find((i) => i.modId === mod.id)!;
                          return (
                            <span
                              key={p.id}
                              className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-white"
                            >
                              <span
                                className="h-2 w-2 rounded-full"
                                style={{ backgroundColor: p.color }}
                              />
                              <span>{p.name}</span>
                              <span className="text-[10px] text-slate-400">
                                ({item.requirement === 'required' ? '必須' : '任意'})
                              </span>
                              <button
                                type="button"
                                disabled={presetBusy}
                                onClick={() => handleRemoveFromPreset(p.id)}
                                className="text-slate-400 hover:text-rose-300"
                              >
                                ×
                              </button>
                            </span>
                          );
                        })}
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={targetPresetId}
                        onChange={(e) => setTargetPresetId(e.target.value)}
                        className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                      >
                        {presetsList.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      <select
                        value={targetPresetReq}
                        onChange={(e) =>
                          setTargetPresetReq(e.target.value as PresetRequirement)
                        }
                        className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                      >
                        <option value="required">必須</option>
                        <option value="optional">任意</option>
                      </select>
                      <button
                        type="button"
                        disabled={presetBusy || !targetPresetId}
                        onClick={handleAddToPreset}
                        className="inline-flex items-center gap-1 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-500 disabled:opacity-50"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        追加
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-200">
                  <Link2 className="h-4 w-4 text-sky-400" />
                  別プラットフォームを手動名寄せ（統合）
                </div>
                <p className="text-xs text-slate-400">
                  同じMODの Modrinth または CurseForge の URL を入力すると、1つのMODレコードに両方のバージョン情報を統合できます。
                </p>
                <form onSubmit={handleMerge} className="flex gap-2">
                  <input
                    type="text"
                    value={mergeUrl}
                    onChange={(e) => setMergeUrl(e.target.value)}
                    placeholder="https://www.curseforge.com/minecraft/mc-mods/..."
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-sky-500 focus:outline-none"
                  />
                  <button
                    type="submit"
                    disabled={merging || !mergeUrl.trim()}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                  >
                    {merging && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    統合する
                  </button>
                </form>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
