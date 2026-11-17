'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowRightLeft,
  Check,
  CheckCircle2,
  Clipboard,
  Download,
  ExternalLink,
  Layers,
  Loader2,
  PackageCheck,
  Plus,
  Share2,
  Trash2,
  XCircle,
} from 'lucide-react';
import {
  LOADER_LABELS,
  LoaderBadge,
  TAG_PALETTE,
  isReleaseMcVersionClient,
} from '@/components/ModBadges';
import type {
  ModPreset,
  ModRecord,
  PresetRequirement,
  RelatedModSummary,
} from '@/types/mod';

const DEFAULT_TARGET_VERSIONS = [
  '1.21.4',
  '1.21.1',
  '1.20.4',
  '1.20.1',
  '1.19.2',
  '1.18.2',
  '1.16.5',
  '1.12.2',
];

const TARGET_LOADERS = ['fabric', 'neoforge', 'forge', 'quilt'];

interface PresetsPanelProps {
  onOpenModDetail: (modId: string) => void;
}

interface MergedItem {
  mod: ModRecord;
  requirement: PresetRequirement;
  notes: string[];
  sourcePresets: Array<{ id: string; name: string; color: string }>;
}

type CompatStatus = 'compatible' | 'alternative' | 'incompatible';

interface EvaluatedItem extends MergedItem {
  compatStatus: CompatStatus;
  matchedAlternative?: RelatedModSummary;
}

function getModPrimaryUrl(mod: {
  modrinthId: string | null;
  modrinthSlug: string | null;
  curseforgeId: string | null;
  curseforgeSlug: string | null;
}): string {
  if (mod.modrinthId) {
    return `https://modrinth.com/mod/${mod.modrinthSlug ?? mod.modrinthId}`;
  }
  if (mod.curseforgeId) {
    return `https://www.curseforge.com/minecraft/mc-mods/${mod.curseforgeSlug ?? mod.curseforgeId}`;
  }
  return '';
}

export function PresetsPanel({ onOpenModDetail }: PresetsPanelProps) {
  const [presets, setPresets] = useState<ModPreset[]>([]);
  const [allMods, setAllMods] = useState<ModRecord[]>([]);
  const [availableVersions, setAvailableVersions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Checked presets for multi-preset combination
  const [checkedPresetIds, setCheckedPresetIds] = useState<string[]>([]);
  // Focused preset for editing items
  const [editingPresetId, setEditingPresetId] = useState<string | null>(null);

  // Create preset form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newColor, setNewColor] = useState(TAG_PALETTE[0]);
  const [creating, setCreating] = useState(false);

  // Add mod to editing preset
  const [modSearch, setModSearch] = useState('');
  const [selectedModToAdd, setSelectedModToAdd] = useState('');
  const [addReq, setAddReq] = useState<PresetRequirement>('required');
  const [addNote, setAddNote] = useState('');
  const [mutating, setMutating] = useState(false);

  // Target environment compatibility checker
  const [targetMcVersion, setTargetMcVersion] = useState('1.20.1');
  const [targetLoader, setTargetLoader] = useState('fabric');
  const [autoSwapAlt, setAutoSwapAlt] = useState(true);

  // Share export modal/preview
  const [shareFormat, setShareFormat] = useState<'discord' | 'markdown' | null>(null);
  const [copied, setCopied] = useState(false);

  // .mrpack export state
  const [mrpackExporting, setMrpackExporting] = useState(false);
  const [mrpackFeedback, setMrpackFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
    skippedMods?: Array<{ id: string; name: string; reason: string }>;
  } | null>(null);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, mRes] = await Promise.all([
        fetch('/api/presets'),
        fetch('/api/mods'),
      ]);
      const pData = await pRes.json();
      const mData = await mRes.json();
      if (!pRes.ok) throw new Error(pData.error || 'プリセット取得に失敗しました');
      if (!mRes.ok) throw new Error(mData.error || 'MOD一覧取得に失敗しました');

      const loadedPresets = (pData.presets ?? []) as ModPreset[];
      setPresets(loadedPresets);
      setAllMods(mData.mods ?? []);

      const relVers = ((mData.facets?.mcVersions ?? []) as string[]).filter(
        isReleaseMcVersionClient
      );
      const mergedVers = Array.from(
        new Set([...relVers, ...DEFAULT_TARGET_VERSIONS])
      );
      setAvailableVersions(mergedVers);

      if (loadedPresets.length > 0) {
        setCheckedPresetIds((prev) => {
          const valid = prev.filter((id) =>
            loadedPresets.some((p) => p.id === id)
          );
          return valid.length > 0 ? valid : [loadedPresets[0].id];
        });
        setEditingPresetId((prev) =>
          prev && loadedPresets.some((p) => p.id === prev)
            ? prev
            : loadedPresets[0].id
        );
      } else {
        setCheckedPresetIds([]);
        setEditingPresetId(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const editingPreset = useMemo(
    () => presets.find((p) => p.id === editingPresetId) ?? null,
    [presets, editingPresetId]
  );

  // Combine checked presets into unified list
  const mergedItems = useMemo<MergedItem[]>(() => {
    const map = new Map<string, MergedItem>();
    for (const preset of presets) {
      if (!checkedPresetIds.includes(preset.id)) continue;
      for (const item of preset.items) {
        const existing = map.get(item.modId);
        if (!existing) {
          map.set(item.modId, {
            mod: item.mod,
            requirement: item.requirement,
            notes: item.note ? [item.note] : [],
            sourcePresets: [
              { id: preset.id, name: preset.name, color: preset.color },
            ],
          });
        } else {
          if (item.requirement === 'required') {
            existing.requirement = 'required';
          }
          if (item.note && !existing.notes.includes(item.note)) {
            existing.notes.push(item.note);
          }
          if (!existing.sourcePresets.some((s) => s.id === preset.id)) {
            existing.sourcePresets.push({
              id: preset.id,
              name: preset.name,
              color: preset.color,
            });
          }
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.requirement !== b.requirement) {
        return a.requirement === 'required' ? -1 : 1;
      }
      return a.mod.name.localeCompare(b.mod.name);
    });
  }, [presets, checkedPresetIds]);

  const targetCombo = `${targetMcVersion}::${targetLoader}`;

  const evaluatedItems = useMemo<EvaluatedItem[]>(() => {
    return mergedItems.map((item) => {
      if (item.mod.supportedCombos.includes(targetCombo)) {
        return { ...item, compatStatus: 'compatible' };
      }
      const matchedAlt = item.mod.alternatives.find((alt) =>
        alt.supportedCombos.includes(targetCombo)
      );
      if (matchedAlt) {
        return {
          ...item,
          compatStatus: 'alternative',
          matchedAlternative: matchedAlt,
        };
      }
      return { ...item, compatStatus: 'incompatible' };
    });
  }, [mergedItems, targetCombo]);

  // Missing dependencies check
  const missingDependencies = useMemo(() => {
    const includedIds = new Set(mergedItems.map((m) => m.mod.id));
    if (autoSwapAlt) {
      for (const ev of evaluatedItems) {
        if (ev.compatStatus === 'alternative' && ev.matchedAlternative) {
          includedIds.add(ev.matchedAlternative.id);
        }
      }
    }

    const missingMap = new Map<
      string,
      { dep: RelatedModSummary; requiredBy: string[]; compatible: boolean }
    >();

    for (const ev of evaluatedItems) {
      const activeModDeps = ev.mod.dependencies;
      for (const dep of activeModDeps) {
        if (includedIds.has(dep.id)) continue;
        const entry = missingMap.get(dep.id);
        if (!entry) {
          missingMap.set(dep.id, {
            dep,
            requiredBy: [ev.mod.name],
            compatible: dep.supportedCombos.includes(targetCombo),
          });
        } else if (!entry.requiredBy.includes(ev.mod.name)) {
          entry.requiredBy.push(ev.mod.name);
        }
      }
    }

    return Array.from(missingMap.values());
  }, [mergedItems, evaluatedItems, autoSwapAlt, targetCombo]);

  const compatCounts = useMemo(() => {
    let ok = 0;
    let alt = 0;
    let ng = 0;
    for (const ev of evaluatedItems) {
      if (ev.compatStatus === 'compatible') ok++;
      else if (ev.compatStatus === 'alternative') alt++;
      else ng++;
    }
    return { ok, alt, ng };
  }, [evaluatedItems]);

  const exportText = useMemo(() => {
    if (!shareFormat) return '';

    const requiredList: Array<{ name: string; url: string; note: string; status: string }> = [];
    const depList: Array<{ name: string; url: string; note: string; status: string }> = [];
    const optionalList: Array<{ name: string; url: string; note: string; status: string }> = [];

    for (const ev of evaluatedItems) {
      const useAlt =
        autoSwapAlt &&
        ev.compatStatus === 'alternative' &&
        ev.matchedAlternative;
      const targetObj = useAlt ? ev.matchedAlternative! : ev.mod;
      const url = getModPrimaryUrl(targetObj);
      const statusTag =
        ev.compatStatus === 'compatible'
          ? '対応'
          : ev.compatStatus === 'alternative'
            ? useAlt
              ? `代替(${ev.mod.name}枠)`
              : `代替あり:${ev.matchedAlternative?.name}`
            : '未対応';

      const row = {
        name: targetObj.name,
        url,
        note: ev.notes.join(' / '),
        status: statusTag,
      };

      const isDepTag = ev.mod.tags.some((t) => t.name === '前提MOD');
      if (ev.requirement === 'optional') optionalList.push(row);
      else if (isDepTag) depList.push(row);
      else requiredList.push(row);
    }

    for (const m of missingDependencies) {
      depList.push({
        name: m.dep.name,
        url: getModPrimaryUrl(m.dep),
        note: `${m.requiredBy.join(', ')} の前提`,
        status: m.compatible ? '対応' : '要確認',
      });
    }

    const activePresetNames = presets
      .filter((p) => checkedPresetIds.includes(p.id))
      .map((p) => p.name)
      .join(' + ');

    if (shareFormat === 'discord') {
      const lines: string[] = [
        `## 🎮 Minecraft MODリスト (${targetMcVersion} / ${LOADER_LABELS[targetLoader] ?? targetLoader})`,
        `構成プリセット: **${activePresetNames || 'なし'}**`,
        '',
      ];
      const pushSection = (
        title: string,
        rows: typeof requiredList
      ) => {
        if (rows.length === 0) return;
        lines.push(`### ${title}`);
        for (const r of rows) {
          const linkPart = r.url ? ` - <${r.url}>` : '';
          const notePart = r.note ? ` (${r.note})` : '';
          lines.push(`- **${r.name}** [${r.status}]${notePart}${linkPart}`);
        }
        lines.push('');
      };
      pushSection('必須MOD', requiredList);
      pushSection('前提MOD', depList);
      pushSection('任意（お好み・クライアント推奨）MOD', optionalList);
      return lines.join('\n').trim();
    }

    // Markdown Table
    const lines: string[] = [
      `# Minecraft MODリスト (${targetMcVersion} / ${LOADER_LABELS[targetLoader] ?? targetLoader})`,
      `構成プリセット: ${activePresetNames || 'なし'}`,
      '',
      '| 区分 | MOD名 | 互換状況 | メモ | 配布URL |',
      '| :--- | :--- | :--- | :--- | :--- |',
    ];
    const pushTable = (label: string, rows: typeof requiredList) => {
      for (const r of rows) {
        lines.push(
          `| ${label} | ${r.name} | ${r.status} | ${r.note || '-'} | ${r.url || '-'} |`
        );
      }
    };
    pushTable('必須', requiredList);
    pushTable('前提', depList);
    pushTable('任意', optionalList);
    return lines.join('\n');
  }, [
    shareFormat,
    evaluatedItems,
    missingDependencies,
    autoSwapAlt,
    presets,
    checkedPresetIds,
    targetMcVersion,
    targetLoader,
  ]);

  async function handleExportMrpack() {
    if (evaluatedItems.length === 0) return;
    setMrpackExporting(true);
    setMrpackFeedback(null);
    setError(null);

    try {
      const resolvedIds = Array.from(
        new Set(
          evaluatedItems.map((ev) => {
            const useAlt =
              autoSwapAlt &&
              ev.compatStatus === 'alternative' &&
              ev.matchedAlternative;
            return useAlt ? ev.matchedAlternative!.id : ev.mod.id;
          })
        )
      );

      const selectedNames = presets
        .filter((p) => checkedPresetIds.includes(p.id))
        .map((p) => p.name);
      const packName =
        selectedNames.length > 0 ? selectedNames.join(' + ') : 'MC MOD Preset';

      const res = await fetch('/api/presets/mrpack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: packName,
          mcVersion: targetMcVersion,
          loader: targetLoader,
          modIds: resolvedIds,
          includeDependencies: true,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setMrpackFeedback({
          type: 'err',
          text: data.error || '.mrpack の出力に失敗しました',
          skippedMods: Array.isArray(data.skippedMods) ? data.skippedMods : undefined,
        });
        return;
      }

      const binary = atob(data.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], {
        type: 'application/x-modrinth-modpack+zip',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = data.filename || `${packName}-${targetMcVersion}-${targetLoader}.mrpack`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);

      const skipped = Array.isArray(data.skippedMods) ? data.skippedMods : [];
      setMrpackFeedback({
        type: 'ok',
        text: `${data.filename} を生成・ダウンロードしました（${data.includedCount} MOD同梱${
          skipped.length > 0 ? ` / ${skipped.length} 件スキップ` : ''
        }）`,
        skippedMods: skipped.length > 0 ? skipped : undefined,
      });
    } catch (err) {
      setMrpackFeedback({
        type: 'err',
        text: err instanceof Error ? err.message : '.mrpack の出力に失敗しました',
      });
    } finally {
      setMrpackExporting(false);
    }
  }

  async function handleCreatePreset(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch('/api/presets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          description: newDesc.trim(),
          color: newColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'プリセット作成に失敗しました');
      const created = data.preset as ModPreset;
      setPresets((prev) => [created, ...prev]);
      setCheckedPresetIds((prev) => [...prev, created.id]);
      setEditingPresetId(created.id);
      setNewName('');
      setNewDesc('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '作成に失敗しました');
    } finally {
      setCreating(false);
    }
  }

  async function handleDeletePreset(id: string) {
    const target = presets.find((p) => p.id === id);
    if (!target || !confirm(`プリセット「${target.name}」を削除しますか？`)) return;
    const res = await fetch(`/api/presets/${id}`, { method: 'DELETE' });
    if (res.ok) {
      await loadData();
    }
  }

  async function handleUpsertModToPreset(
    presetId: string,
    modId: string,
    requirement: PresetRequirement,
    note?: string
  ) {
    setMutating(true);
    setError(null);
    try {
      const res = await fetch(`/api/presets/${presetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          upsertMod: { modId, requirement, note },
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'MODの追加に失敗しました');
      setPresets((prev) =>
        prev.map((p) => (p.id === presetId ? data.preset : p))
      );
      setSelectedModToAdd('');
      setAddNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新に失敗しました');
    } finally {
      setMutating(false);
    }
  }

  async function handleRemoveModFromPreset(presetId: string, modId: string) {
    setMutating(true);
    try {
      const res = await fetch(`/api/presets/${presetId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ removeModId: modId }),
      });
      const data = await res.json();
      if (res.ok) {
        setPresets((prev) =>
          prev.map((p) => (p.id === presetId ? data.preset : p))
        );
      }
    } finally {
      setMutating(false);
    }
  }

  function toggleCheckedPreset(id: string) {
    setCheckedPresetIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  const candidateModsToAdd = useMemo(() => {
    const existingIds = new Set(
      editingPreset?.items.map((i) => i.modId) ?? []
    );
    const term = modSearch.trim().toLowerCase();
    return allMods
      .filter((m) => !existingIds.has(m.id))
      .filter(
        (m) =>
          !term ||
          m.name.toLowerCase().includes(term) ||
          m.jaName.toLowerCase().includes(term) ||
          m.slug.toLowerCase().includes(term)
      );
  }, [allMods, editingPreset, modSearch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <Loader2 className="mr-2 h-6 w-6 animate-spin text-emerald-400" />
        プリセットを読み込み中...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Left Pane: Presets List & Editor */}
        <div className="space-y-4 lg:col-span-4">
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3">
            <h2 className="flex items-center gap-2 text-sm font-bold text-white">
              <Layers className="h-4 w-4 text-emerald-400" />
              パーツ別 MOD プリセット
            </h2>
            <p className="text-xs text-slate-400">
              チェックを入れた複数プリセットを右側の互換チェッカーに合算します。
            </p>

            {/* New Preset Form */}
            <form
              onSubmit={handleCreatePreset}
              className="rounded-xl border border-slate-800 bg-slate-950/70 p-3 space-y-2"
            >
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="新規プリセット名 (例: 軽量化ベース)"
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
                <select
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs"
                  style={{ color: newColor }}
                >
                  {TAG_PALETTE.map((c) => (
                    <option key={c} value={c} style={{ color: c }}>
                      ●
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  placeholder="説明（任意）"
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1 text-xs text-white placeholder-slate-500 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={creating || !newName.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  作成
                </button>
              </div>
            </form>

            {/* Preset Cards */}
            {presets.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 py-8 text-center text-xs text-slate-500">
                プリセットがまだありません。上のフォームから作成してください。
              </div>
            ) : (
              <div className="space-y-2">
                {presets.map((p) => {
                  const checked = checkedPresetIds.includes(p.id);
                  const isEditing = editingPresetId === p.id;
                  return (
                    <div
                      key={p.id}
                      className={`rounded-xl border p-3 transition ${
                        isEditing
                          ? 'border-emerald-500/70 bg-emerald-950/20'
                          : 'border-slate-800 bg-slate-900/50 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0 flex-1">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleCheckedPreset(p.id)}
                            className="mt-1 rounded border-slate-600 bg-slate-950 text-emerald-500 cursor-pointer"
                            title="環境シミュレータに合算"
                          />
                          <button
                            type="button"
                            onClick={() => setEditingPresetId(p.id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <div className="flex items-center gap-1.5">
                              <span
                                className="h-2.5 w-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: p.color }}
                              />
                              <span className="truncate text-sm font-bold text-white">
                                {p.name}
                              </span>
                              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300">
                                {p.items.length}件
                              </span>
                            </div>
                            {p.description && (
                              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                                {p.description}
                              </p>
                            )}
                          </button>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleDeletePreset(p.id)}
                          className="rounded p-1 text-slate-500 hover:bg-slate-800 hover:text-rose-300"
                          title="プリセット削除"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add MOD into focused preset */}
          {editingPreset && (
            <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-200">
                  「{editingPreset.name}」に MOD を追加
                </h3>
              </div>

              {allMods.length === 0 ? (
                <p className="text-xs text-slate-500">
                  マイDBにMODがまだ登録されていません。先にMODを登録してください。
                </p>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={modSearch}
                    onChange={(e) => setModSearch(e.target.value)}
                    placeholder="登録済みMODを絞り込み..."
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none"
                  />
                  <select
                    value={selectedModToAdd}
                    onChange={(e) => setSelectedModToAdd(e.target.value)}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="">追加するMODを選択...</option>
                    {candidateModsToAdd.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} {m.jaName ? `(${m.jaName})` : ''}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <select
                      value={addReq}
                      onChange={(e) =>
                        setAddReq(e.target.value as PresetRequirement)
                      }
                      className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white focus:outline-none"
                    >
                      <option value="required">必須 (Required)</option>
                      <option value="optional">任意 (Optional)</option>
                    </select>
                    <input
                      type="text"
                      value={addNote}
                      onChange={(e) => setAddNote(e.target.value)}
                      placeholder="メモ（任意）"
                      className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none"
                    />
                  </div>
                  <button
                    type="button"
                    disabled={mutating || !selectedModToAdd}
                    onClick={() =>
                      handleUpsertModToPreset(
                        editingPreset.id,
                        selectedModToAdd,
                        addReq,
                        addNote
                      )
                    }
                    className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-emerald-600 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    プリセットに追加
                  </button>
                </div>
              )}

              {/* Current items inside focused preset */}
              {editingPreset.items.length > 0 && (
                <div className="space-y-1.5 border-t border-slate-800 pt-3">
                  <div className="text-[11px] font-semibold text-slate-400">
                    このプリセット内のMOD ({editingPreset.items.length})
                  </div>
                  <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                    {editingPreset.items.map((item) => (
                      <div
                        key={item.modId}
                        className="flex items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-2.5 py-1.5 text-xs"
                      >
                        <button
                          type="button"
                          onClick={() => onOpenModDetail(item.modId)}
                          className="truncate font-medium text-slate-200 hover:text-emerald-300 text-left flex-1"
                        >
                          {item.mod.name}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpsertModToPreset(
                              editingPreset.id,
                              item.modId,
                              item.requirement === 'required'
                                ? 'optional'
                                : 'required'
                            )
                          }
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            item.requirement === 'required'
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-slate-700 text-slate-300'
                          }`}
                          title="クリックで必須/任意を切替"
                        >
                          {item.requirement === 'required' ? '必須' : '任意'}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleRemoveModFromPreset(
                              editingPreset.id,
                              item.modId
                            )
                          }
                          className="text-slate-500 hover:text-rose-300"
                          title="このプリセットから外す"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Pane: Combined Environment Simulator & Compatibility Checker */}
        <div className="space-y-4 lg:col-span-8">
          <div className="rounded-xl border border-slate-800 bg-[#111827] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-white">
                  <PackageCheck className="h-5 w-5 text-emerald-400" />
                  環境シミュレータ ＆ 一括互換チェッカー
                </h2>
                <p className="text-xs text-slate-400">
                  選択中のプリセット（{checkedPresetIds.length}個 / 計{' '}
                  {mergedItems.length} MOD）がターゲット環境で動くか一括判定します。
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={evaluatedItems.length === 0 || mrpackExporting}
                  onClick={handleExportMrpack}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-3 py-1.5 text-xs font-semibold text-emerald-200 hover:bg-emerald-500/25 disabled:opacity-40"
                >
                  {mrpackExporting ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  📦 .mrpack 出力
                </button>
                <button
                  type="button"
                  disabled={evaluatedItems.length === 0}
                  onClick={() => {
                    setCopied(false);
                    setShareFormat('discord');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-500/40 bg-indigo-500/15 px-3 py-1.5 text-xs font-semibold text-indigo-200 hover:bg-indigo-500/25 disabled:opacity-40"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Discord用に共有出力
                </button>
                <button
                  type="button"
                  disabled={evaluatedItems.length === 0}
                  onClick={() => {
                    setCopied(false);
                    setShareFormat('markdown');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                >
                  Markdown表出力
                </button>
              </div>
            </div>

            {mrpackFeedback && (
              <div
                className={`rounded-xl border px-3.5 py-2.5 text-xs ${
                  mrpackFeedback.type === 'ok'
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-200'
                    : 'border-rose-500/35 bg-rose-500/10 text-rose-200'
                }`}
              >
                <div className="font-semibold">{mrpackFeedback.text}</div>
                {mrpackFeedback.skippedMods && mrpackFeedback.skippedMods.length > 0 && (
                  <ul className="mt-1.5 space-y-0.5 text-[11px] opacity-90">
                    {mrpackFeedback.skippedMods.map((s) => (
                      <li key={s.id}>
                        ・{s.name}: {s.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Target Environment Picker */}
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-950/70 p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-slate-300">
                  ターゲット環境:
                </span>
                <select
                  value={targetMcVersion}
                  onChange={(e) => setTargetMcVersion(e.target.value)}
                  className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
                >
                  {availableVersions.map((v) => (
                    <option key={v} value={v}>
                      MC {v}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-wrap gap-1">
                {TARGET_LOADERS.map((ld) => (
                  <button
                    key={ld}
                    type="button"
                    onClick={() => setTargetLoader(ld)}
                    className={`rounded-lg border px-2.5 py-1 text-xs font-medium transition ${
                      targetLoader === ld
                        ? 'border-emerald-500 bg-emerald-500/20 text-white'
                        : 'border-slate-800 bg-slate-900 text-slate-400 hover:text-white'
                    }`}
                  >
                    {LOADER_LABELS[ld] ?? ld}
                  </button>
                ))}
              </div>

              <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoSwapAlt}
                  onChange={(e) => setAutoSwapAlt(e.target.checked)}
                  className="rounded border-slate-600 bg-slate-950 text-emerald-500"
                />
                代替MODがあれば出力時に自動置換
              </label>
            </div>

            {/* Compatibility Summary */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3">
                <div className="text-xs text-emerald-300">🟢 対応済み</div>
                <div className="mt-0.5 text-xl font-extrabold text-white">
                  {compatCounts.ok}
                </div>
              </div>
              <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3">
                <div className="text-xs text-sky-300">🔄 代替MODで対応</div>
                <div className="mt-0.5 text-xl font-extrabold text-white">
                  {compatCounts.alt}
                </div>
              </div>
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3">
                <div className="text-xs text-rose-300">🔴 未対応</div>
                <div className="mt-0.5 text-xl font-extrabold text-white">
                  {compatCounts.ng}
                </div>
              </div>
            </div>

            {/* Missing Dependencies Alert */}
            {missingDependencies.length > 0 && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3.5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-amber-200">
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                  不足している前提MODが {missingDependencies.length} 件検出されました
                </div>
                <div className="space-y-1.5">
                  {missingDependencies.map(({ dep, requiredBy, compatible }) => (
                    <div
                      key={dep.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/20 bg-slate-950/60 px-3 py-1.5 text-xs"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-white">
                          {dep.name}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          (必要元: {requiredBy.join(', ')})
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            compatible
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-rose-500/20 text-rose-300'
                          }`}
                        >
                          {compatible
                            ? `${targetMcVersion}×${targetLoader} 対応`
                            : `${targetMcVersion}×${targetLoader} 未対応`}
                        </span>
                      </div>
                      {editingPreset && (
                        <button
                          type="button"
                          disabled={mutating}
                          onClick={() =>
                            handleUpsertModToPreset(
                              editingPreset.id,
                              dep.id,
                              'required',
                              `${requiredBy[0]} の前提`
                            )
                          }
                          className="inline-flex items-center gap-1 rounded bg-amber-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-amber-500"
                        >
                          <Plus className="h-3 w-3" />
                          「{editingPreset.name}」に追加
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Evaluated MODs Table */}
            {evaluatedItems.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 py-14 text-center text-xs text-slate-500">
                左ペインでプリセットを選択してMODを追加すると、ここに互換チェック結果が表示されます。
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400">
                    <tr>
                      <th className="px-3 py-2.5 font-semibold">区分</th>
                      <th className="px-3 py-2.5 font-semibold">MOD</th>
                      <th className="px-3 py-2.5 font-semibold">
                        {targetMcVersion} × {LOADER_LABELS[targetLoader] ?? targetLoader} 判定
                      </th>
                      <th className="px-3 py-2.5 font-semibold">含まれるプリセット</th>
                      <th className="px-3 py-2.5 font-semibold text-right">リンク</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {evaluatedItems.map((ev) => (
                      <tr
                        key={ev.mod.id}
                        className="hover:bg-slate-800/35"
                      >
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                              ev.requirement === 'required'
                                ? 'bg-emerald-500/20 text-emerald-300'
                                : 'bg-slate-700 text-slate-300'
                            }`}
                          >
                            {ev.requirement === 'required' ? '必須' : '任意'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <button
                            type="button"
                            onClick={() => onOpenModDetail(ev.mod.id)}
                            className="flex items-center gap-2 text-left hover:text-emerald-300"
                          >
                            {ev.mod.iconUrl ? (
                              <img
                                src={ev.mod.iconUrl}
                                alt={ev.mod.name}
                                className="h-7 w-7 rounded border border-slate-700 object-cover"
                              />
                            ) : (
                              <div className="flex h-7 w-7 items-center justify-center rounded border border-slate-700 bg-slate-800 text-[9px]">
                                MOD
                              </div>
                            )}
                            <div>
                              <div className="font-bold text-white">
                                {ev.mod.name}
                              </div>
                              {ev.notes.length > 0 && (
                                <div className="text-[10px] text-amber-300/90">
                                  {ev.notes.join(' / ')}
                                </div>
                              )}
                            </div>
                          </button>
                        </td>
                        <td className="px-3 py-2.5">
                          {ev.compatStatus === 'compatible' && (
                            <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[11px] font-semibold text-emerald-300">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              対応済み
                            </span>
                          )}
                          {ev.compatStatus === 'alternative' &&
                            ev.matchedAlternative && (
                              <div className="space-y-1">
                                <span className="inline-flex items-center gap-1 rounded-md bg-sky-500/15 px-2 py-1 text-[11px] font-semibold text-sky-300">
                                  <ArrowRightLeft className="h-3.5 w-3.5" />
                                  代替: {ev.matchedAlternative.name}
                                </span>
                              </div>
                            )}
                          {ev.compatStatus === 'incompatible' && (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-[11px] font-semibold text-rose-300">
                                <XCircle className="h-3.5 w-3.5" />
                                未対応
                              </span>
                              <div className="flex gap-1">
                                {ev.mod.loaders.map((ld) => (
                                  <LoaderBadge key={ld} loader={ld} />
                                ))}
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {ev.sourcePresets.map((sp) => (
                              <span
                                key={sp.id}
                                className="inline-flex items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[10px] text-slate-300"
                              >
                                <span
                                  className="h-1.5 w-1.5 rounded-full"
                                  style={{ backgroundColor: sp.color }}
                                />
                                {sp.name}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {(() => {
                            const url = getModPrimaryUrl(
                              autoSwapAlt && ev.matchedAlternative
                                ? ev.matchedAlternative
                                : ev.mod
                            );
                            return url ? (
                              <a
                                href={url}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800 hover:text-white"
                              >
                                開く <ExternalLink className="h-3 w-3" />
                              </a>
                            ) : null;
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Share / Export Modal */}
      {shareFormat && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
          onClick={() => setShareFormat(null)}
        >
          <div
            className="w-full max-w-2xl rounded-2xl border border-slate-800 bg-[#0f1623] p-5 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Share2 className="h-4 w-4 text-indigo-400" />
                <h3 className="text-sm font-bold text-white">
                  身内共有用リスト出力（
                  {shareFormat === 'discord' ? 'Discord テキスト' : 'Markdown 表'}
                  ）
                </h3>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShareFormat('discord')}
                  className={`rounded px-2.5 py-1 text-xs ${
                    shareFormat === 'discord'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  Discord
                </button>
                <button
                  type="button"
                  onClick={() => setShareFormat('markdown')}
                  className={`rounded px-2.5 py-1 text-xs ${
                    shareFormat === 'markdown'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                >
                  Markdown表
                </button>
              </div>
            </div>

            <textarea
              readOnly
              rows={14}
              value={exportText}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-xs text-slate-200 focus:outline-none"
            />

            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShareFormat(null)}
                className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800"
              >
                閉じる
              </button>
              <button
                type="button"
                onClick={async () => {
                  await navigator.clipboard.writeText(exportText);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-emerald-500"
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    コピーしました！
                  </>
                ) : (
                  <>
                    <Clipboard className="h-3.5 w-3.5" />
                    クリップボードにコピー
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
