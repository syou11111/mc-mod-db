'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Check, GitBranch, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { TAG_PALETTE } from '@/components/ModBadges';
import type { ModTag } from '@/types/mod';

interface TagHierarchyModalProps {
  open: boolean;
  tags: ModTag[];
  onClose: () => void;
  onTagsChanged: (tags: ModTag[]) => void;
  onRefreshAll: () => void;
}

export function TagHierarchyModal({
  open,
  tags,
  onClose,
  onTagsChanged,
  onRefreshAll,
}: TagHierarchyModalProps) {
  const [selectedTagId, setSelectedTagId] = useState<string>('');
  const [search, setSearch] = useState('');
  const [includeOfficial, setIncludeOfficial] = useState(false);
  const [parentCandidateId, setParentCandidateId] = useState('');
  const [childCandidateId, setChildCandidateId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [newTagName, setNewTagName] = useState('');
  const [newTagColor, setNewTagColor] = useState(TAG_PALETTE[0]);

  const [editName, setEditName] = useState('');
  const [editColor, setEditColor] = useState(TAG_PALETTE[0]);

  const tagMap = useMemo(() => {
    const m = new Map<string, ModTag>();
    for (const t of tags) m.set(t.id, t);
    return m;
  }, [tags]);

  const visibleTags = useMemo(() => {
    return tags
      .filter((t) => includeOfficial || t.kind === 'custom')
      .filter(
        (t) =>
          !search.trim() ||
          t.name.toLowerCase().includes(search.trim().toLowerCase())
      );
  }, [tags, includeOfficial, search]);

  const activeTag = tagMap.get(selectedTagId) ?? visibleTags[0] ?? null;

  useEffect(() => {
    if (activeTag) {
      setEditName(activeTag.name);
      setEditColor(activeTag.color);
    }
  }, [activeTag?.id, activeTag?.name, activeTag?.color]);

  const hierarchyRoots = useMemo(() => {
    return tags.filter(
      (t) => t.parentIds.length === 0 && t.childIds.length > 0
    );
  }, [tags]);

  if (!open) return null;

  async function handleAddRelation(parentId: string, childId: string) {
    if (!parentId || !childId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/tags/relations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentTagId: parentId, childTagId: childId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '紐付けに失敗しました');
      onTagsChanged(data.tags);
      onRefreshAll();
      setParentCandidateId('');
      setChildCandidateId('');
      setNotice('タグの親子関係を更新しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '紐付けに失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveRelation(parentId: string, childId: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/tags/relations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentTagId: parentId, childTagId: childId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '解除に失敗しました');
      onTagsChanged(data.tags);
      onRefreshAll();
      setNotice('親子関係を解除しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : '解除に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!newTagName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newTagName.trim(), color: newTagColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '作成に失敗しました');
      const created = data.tag as ModTag;
      setNewTagName('');
      setSelectedTagId(created.id);
      onRefreshAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : '作成に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpdateTag(e: React.FormEvent) {
    e.preventDefault();
    if (!activeTag || !editName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/tags/${activeTag.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), color: editColor }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'タグ更新に失敗しました');
      onRefreshAll();
      setNotice('タグの名称・カラーを更新しました');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグ更新に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteTag() {
    if (!activeTag) return;
    const tagName = activeTag.name;
    const tagId = activeTag.id;
    if (
      !confirm(
        `タグ「${tagName}」を削除しますか？（MODへの付与状態や親子関係からも解除されます）`
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/tags/${tagId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'タグ削除に失敗しました');
      setSelectedTagId('');
      onRefreshAll();
      setNotice(`タグ「${tagName}」を削除しました`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'タグ削除に失敗しました');
    } finally {
      setBusy(false);
    }
  }

  function renderTreeNode(
    tagId: string,
    depth: number,
    path: Set<string>
  ): React.ReactNode {
    const tag = tagMap.get(tagId);
    if (!tag || path.has(tagId) || depth > 8) return null;
    const nextPath = new Set(path);
    nextPath.add(tagId);

    return (
      <div key={`${depth}-${tagId}`} className="space-y-1">
        <div
          className="flex items-center gap-1.5 text-xs"
          style={{ paddingLeft: `${depth * 18}px` }}
        >
          {depth > 0 && <span className="text-slate-600">└─</span>}
          <button
            type="button"
            onClick={() => setSelectedTagId(tag.id)}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 transition ${
              activeTag?.id === tag.id
                ? 'border-emerald-400 bg-emerald-500/20 text-white'
                : 'border-slate-700 bg-slate-900 text-slate-200 hover:border-slate-500'
            }`}
          >
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: tag.color }}
            />
            <span>{tag.name}</span>
            {tag.childIds.length > 0 && (
              <span className="text-[10px] text-slate-400">
                ({tag.childIds.length})
              </span>
            )}
          </button>
        </div>
        {tag.childIds.map((cid) => renderTreeNode(cid, depth + 1, nextPath))}
      </div>
    );
  }

  const selectablePool = tags.filter(
    (t) => (includeOfficial || t.kind === 'custom') && t.id !== activeTag?.id
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-[#0f1623] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h2 className="flex items-center gap-2 text-base font-bold text-white">
              <GitBranch className="h-5 w-5 text-emerald-400" />
              タグ管理・メタタグ階層設定（名称変更 / 削除 / 親子DAG）
            </h2>
            <p className="text-xs text-slate-400">
              「技術系 ➔ 自動化 ➔ Create系」のように何段階でも親タグを紐付けられます（循環参照は自動ブロック）。
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid flex-1 grid-cols-1 overflow-y-auto md:grid-cols-12">
          {/* Left Tag List */}
          <div className="border-b border-slate-800 p-4 space-y-3 md:col-span-5 md:border-b-0 md:border-r">
            <div className="flex items-center justify-between gap-2">
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="タグを検索..."
                className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
              />
              <label className="flex items-center gap-1 text-[11px] text-slate-400 cursor-pointer shrink-0">
                <input
                  type="checkbox"
                  checked={includeOfficial}
                  onChange={(e) => setIncludeOfficial(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-950 text-emerald-500"
                />
                公式含む
              </label>
            </div>

            <form
              onSubmit={handleCreateTag}
              className="flex items-center gap-1.5 rounded-lg border border-slate-800 bg-slate-950/60 p-2"
            >
              <input
                type="text"
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                placeholder="親用/子用の新規タグ作成..."
                className="flex-1 bg-transparent px-1 text-xs text-white placeholder-slate-500 focus:outline-none"
              />
              <select
                value={newTagColor}
                onChange={(e) => setNewTagColor(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px]"
                style={{ color: newTagColor }}
              >
                {TAG_PALETTE.map((c) => (
                  <option key={c} value={c} style={{ color: c }}>
                    ●
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={busy || !newTagName.trim()}
                className="inline-flex items-center gap-1 rounded bg-emerald-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                作成
              </button>
            </form>

            <div className="max-h-72 space-y-1 overflow-y-auto pr-1">
              {visibleTags.map((t) => {
                const isActive = activeTag?.id === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setSelectedTagId(t.id);
                      setError(null);
                      setNotice(null);
                    }}
                    className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition ${
                      isActive
                        ? 'border-emerald-500 bg-emerald-500/15 text-white'
                        : 'border-slate-800/80 bg-slate-900/50 text-slate-300 hover:border-slate-700'
                    }`}
                  >
                    <span className="flex items-center gap-2 truncate">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full"
                        style={{ backgroundColor: t.color }}
                      />
                      <span className="truncate font-medium">{t.name}</span>
                    </span>
                    <span className="text-[10px] text-slate-500 shrink-0">
                      親{t.parentIds.length} / 子{t.childIds.length}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right Relation Editor & Tree */}
          <div className="p-5 space-y-5 md:col-span-7 overflow-y-auto">
            {error && (
              <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {error}
              </div>
            )}
            {notice && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {notice}
              </div>
            )}

            {activeTag ? (
              <>
                <div className="space-y-3 border-b border-slate-800 pb-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 rounded-full"
                        style={{ backgroundColor: activeTag.color }}
                      />
                      <h3 className="text-base font-bold text-white">
                        {activeTag.name}
                      </h3>
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                        {activeTag.kind === 'official' ? '公式' : 'カスタム'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={handleDeleteTag}
                      disabled={busy}
                      className="inline-flex items-center gap-1 rounded-lg border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      このタグを削除
                    </button>
                  </div>

                  <form
                    onSubmit={handleUpdateTag}
                    className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 p-2.5"
                  >
                    <Pencil className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="タグ名..."
                      className="min-w-[160px] flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white focus:border-emerald-500 focus:outline-none"
                    />
                    <select
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                      style={{ color: editColor }}
                      title="タグカラーを変更"
                    >
                      {!TAG_PALETTE.includes(editColor) && (
                        <option value={editColor} style={{ color: editColor }}>
                          ● 現在色
                        </option>
                      )}
                      {TAG_PALETTE.map((c) => (
                        <option key={c} value={c} style={{ color: c }}>
                          ● {c}
                        </option>
                      ))}
                    </select>
                    <button
                      type="submit"
                      disabled={
                        busy ||
                        !editName.trim() ||
                        (editName.trim() === activeTag.name &&
                          editColor === activeTag.color)
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
                    >
                      <Check className="h-3.5 w-3.5" />
                      変更を保存
                    </button>
                  </form>
                </div>

                {/* Parents */}
                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
                  <div className="text-xs font-semibold text-slate-200">
                    親タグ（このタグに付ける上位メタタグ）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeTag.parentIds.length === 0 ? (
                      <span className="text-xs text-slate-500">
                        親タグはまだ設定されていません（ルートタグ）
                      </span>
                    ) : (
                      activeTag.parentIds.map((pid) => {
                        const pTag = tagMap.get(pid);
                        if (!pTag) return null;
                        return (
                          <span
                            key={pid}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-white"
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: pTag.color }}
                            />
                            {pTag.name}
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveRelation(pid, activeTag.id)
                              }
                              disabled={busy}
                              className="text-slate-400 hover:text-rose-300"
                              title="解除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <select
                      value={parentCandidateId}
                      onChange={(e) => setParentCandidateId(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    >
                      <option value="">親にするメタタグを選択...</option>
                      {selectablePool
                        .filter((t) => !activeTag.parentIds.includes(t.id))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !parentCandidateId}
                      onClick={() =>
                        handleAddRelation(parentCandidateId, activeTag.id)
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                    >
                      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                      親を追加
                    </button>
                  </div>
                </div>

                {/* Children */}
                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/50 p-3.5">
                  <div className="text-xs font-semibold text-slate-200">
                    子タグ（このタグで検索したときに一緒にヒットするタグ）
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {activeTag.childIds.length === 0 ? (
                      <span className="text-xs text-slate-500">
                        子タグはまだありません
                      </span>
                    ) : (
                      activeTag.childIds.map((cid) => {
                        const cTag = tagMap.get(cid);
                        if (!cTag) return null;
                        return (
                          <span
                            key={cid}
                            className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-white"
                          >
                            <span
                              className="h-2 w-2 rounded-full"
                              style={{ backgroundColor: cTag.color }}
                            />
                            {cTag.name}
                            <button
                              type="button"
                              onClick={() =>
                                handleRemoveRelation(activeTag.id, cid)
                              }
                              disabled={busy}
                              className="text-slate-400 hover:text-rose-300"
                              title="解除"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </span>
                        );
                      })
                    )}
                  </div>
                  <div className="flex gap-2 pt-1">
                    <select
                      value={childCandidateId}
                      onChange={(e) => setChildCandidateId(e.target.value)}
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    >
                      <option value="">配下に追加する子タグを選択...</option>
                      {selectablePool
                        .filter((t) => !activeTag.childIds.includes(t.id))
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy || !childCandidateId}
                      onClick={() =>
                        handleAddRelation(activeTag.id, childCandidateId)
                      }
                      className="inline-flex items-center gap-1 rounded-lg bg-sky-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                    >
                      {busy && <Loader2 className="h-3 w-3 animate-spin" />}
                      子を追加
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-xs text-slate-500">タグがありません。</p>
            )}

            {/* Full Hierarchy Tree Preview */}
            <div className="space-y-2 border-t border-slate-800 pt-4">
              <div className="text-xs font-semibold text-slate-300">
                現在のメタタグ階層ツリープレビュー
              </div>
              {hierarchyRoots.length === 0 ? (
                <p className="text-xs text-slate-500">
                  まだ親子関係が設定されたタグはありません。上のフォームから「親タグ」や「子タグ」を紐付けるとツリーが表示されます。
                </p>
              ) : (
                <div className="max-h-48 space-y-2 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-3">
                  {hierarchyRoots.map((root) =>
                    renderTreeNode(root.id, 0, new Set())
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
