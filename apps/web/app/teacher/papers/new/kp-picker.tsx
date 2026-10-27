"use client";

import { useMemo, useState } from "react";
import {
  groupKpsForPicker,
  stageForGrade,
  stageLabel,
  type KpPickerItem,
} from "@/lib/kp-picker";

/**
 * 知识点选择器（受控）：
 * - 顶部：已选 chips（可直接取消）+ 清空
 * - 搜索框：按名称/代码过滤
 * - 按「学段」自动过滤 + 按「领域」分组折叠，避免一屏铺 185 个 KP
 */
export function KpPicker({
  kps,
  gradeLevel,
  selectedIds,
  onToggle,
  onClear,
}: {
  kps: KpPickerItem[];
  gradeLevel: string;
  selectedIds: string[];
  onToggle: (id: string) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const { groups, matchedCount, hiddenByStage } = useMemo(
    () => groupKpsForPicker(kps, { gradeLevel, query, selectedIds }),
    [kps, gradeLevel, query, selectedIds],
  );
  const selectedItems = useMemo(
    () => kps.filter((item) => selectedIds.includes(item.id)),
    [kps, selectedIds],
  );
  const stage = stageForGrade(gradeLevel);

  return (
    <div data-testid="kp-picker">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-700">
          知识点（至少选 1 个）
          <span className="ml-2 text-xs font-normal text-slate-500">
            已选 {selectedItems.length} 个
          </span>
        </p>
        {selectedItems.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-xs text-slate-500 underline hover:text-slate-800"
            data-testid="kp-clear"
          >
            清空已选
          </button>
        )}
      </div>

      {selectedItems.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {selectedItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onToggle(item.id)}
              title="点击取消选择"
              className="rounded-full border border-slate-950 bg-slate-950 px-3 py-1 text-sm text-white"
              data-testid={`kp-selected-${item.id}`}
            >
              {item.name} ×
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索知识点，如：二次函数 / 圆 / 概率"
          className="w-full max-w-sm rounded-lg border border-slate-200 px-3 py-2 text-sm"
          data-testid="kp-search"
        />
        <span className="text-xs text-slate-500">
          当前显示「{stageLabel(stage)}」知识点
          {hiddenByStage > 0 ? `，已隐藏 ${hiddenByStage} 个其它学段` : ""}
          {query ? `，匹配 ${matchedCount} 个` : ""}
        </span>
      </div>

      <div className="mt-2 space-y-2">
        {groups.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">
            没有匹配的知识点，换个关键词或切换年级试试。
          </p>
        ) : (
          groups.map((group, index) => (
            <details
              key={group.key}
              open={Boolean(query) || index === 0}
              className="rounded-lg border border-slate-200 px-3 py-2"
              data-testid={`kp-group-${group.key}`}
            >
              <summary className="cursor-pointer text-sm font-medium text-slate-700">
                {group.label}
                <span className="ml-2 text-xs font-normal text-slate-500">{group.items.length} 个</span>
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {group.items.map((item) => {
                  const selected = selectedIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onToggle(item.id)}
                      className={`rounded-full border px-3 py-1 text-sm transition ${
                        selected
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-200 text-slate-700 hover:bg-slate-50"
                      }`}
                      data-testid={`kp-${item.id}`}
                    >
                      {item.name}
                    </button>
                  );
                })}
              </div>
            </details>
          ))
        )}
      </div>

      {selectedIds.length === 0 && <p className="mt-1 text-xs text-red-600">请至少选一个知识点。</p>}
    </div>
  );
}
