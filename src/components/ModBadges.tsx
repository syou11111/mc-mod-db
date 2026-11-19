'use client';

import React from 'react';
import type { ModSide, ModStatus, ModTag } from '@/types/mod';

export const LOADER_COLORS: Record<string, string> = {
  fabric: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  neoforge: 'bg-orange-500/15 text-orange-300 border-orange-500/30',
  forge: 'bg-sky-500/15 text-sky-300 border-sky-500/30',
  quilt: 'bg-purple-500/15 text-purple-300 border-purple-500/30',
  liteloader: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30',
  datapack: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30',
};

export const LOADER_LABELS: Record<string, string> = {
  fabric: 'Fabric',
  neoforge: 'NeoForge',
  forge: 'Forge',
  quilt: 'Quilt',
  liteloader: 'LiteLoader',
  rift: 'Rift',
  datapack: 'Datapack',
};

export const STATUS_CONFIG: Record<
  ModStatus,
  { label: string; badgeClass: string }
> = {
  adopted: {
    label: '採用',
    badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/35',
  },
  candidate: {
    label: '候補',
    badgeClass: 'bg-sky-500/15 text-sky-300 border-sky-500/35',
  },
  deprecated: {
    label: '非推奨',
    badgeClass: 'bg-rose-500/15 text-rose-300 border-rose-500/35',
  },
};

export const SIDE_LABELS: Record<ModSide, string> = {
  required: '必須',
  optional: '任意',
  unsupported: '非対応',
  unknown: '不明',
};

export const TAG_PALETTE = [
  '#10b981',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f59e0b',
  '#ef4444',
  '#06b6d4',
  '#eab308',
  '#64748b',
];

export function formatDownloads(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

export function isReleaseMcVersionClient(version: string): boolean {
  return /^\d+\.\d+(?:\.\d+)?$/.test(version.trim());
}

export function LoaderBadge({ loader }: { loader: string }) {
  const key = loader.toLowerCase();
  const cls =
    LOADER_COLORS[key] ?? 'bg-slate-700/60 text-slate-300 border-slate-600';
  return (
    <span
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {LOADER_LABELS[key] ?? loader}
    </span>
  );
}

export function StatusBadge({ status }: { status: ModStatus }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.candidate;
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${cfg.badgeClass}`}
    >
      {cfg.label}
    </span>
  );
}

export function TagPill({
  tag,
  onRemove,
  compact = false,
}: {
  tag: ModTag;
  onRemove?: () => void;
  compact?: boolean;
}) {
  const isOfficial = tag.kind === 'official';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border ${
        compact ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs'
      } ${
        isOfficial
          ? 'border-slate-700/80 bg-slate-800/70 text-slate-300'
          : 'font-medium text-slate-100'
      }`}
      style={
        isOfficial
          ? undefined
          : {
              backgroundColor: `${tag.color}22`,
              borderColor: `${tag.color}55`,
              color: '#f1f5f9',
            }
      }
    >
      {!isOfficial && (
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: tag.color }}
        />
      )}
      <span>{tag.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 rounded px-0.5 text-slate-400 hover:bg-white/10 hover:text-white"
          title="タグを外す"
        >
          ×
        </button>
      )}
    </span>
  );
}

export function formatLinkedDependenciesText(
  deps: Array<{ name: string; newlyImported?: boolean }>
): string {
  if (deps.length === 0) return '';
  const newlyAdded = deps.filter((d) => d.newlyImported);
  const existing = deps.filter((d) => !d.newlyImported);

  if (newlyAdded.length > 0 && existing.length > 0) {
    return `前提MOD ${deps.length}件連携（新規登録 ${newlyAdded.length}件: ${newlyAdded.map((d) => d.name).join(', ')} / 既存DB紐付け ${existing.length}件: ${existing.map((d) => d.name).join(', ')}）`;
  }
  if (newlyAdded.length > 0) {
    return `前提MOD ${newlyAdded.length}件を新規登録・連携（${newlyAdded.map((d) => d.name).join(', ')}）`;
  }
  return `既存DBの前提MOD ${existing.length}件を紐付け（${existing.map((d) => d.name).join(', ')}）`;
}

