"use client";

import { useState, useRef } from "react";
import type { CardModel } from "@/generated/prisma/models";
import type { DependencyModel } from "@/generated/prisma/models";
import { parseTags, TASK_TYPE_LABELS, TASK_TYPE_COLORS } from "@/features/board/types";
import { formatDate } from "@/features/board/dates";
import { EditCardModal } from "./EditCardModal";

export function Card({
  card,
  estimatedDone,
  allCards,
  dependencies,
}: {
  card: CardModel;
  estimatedDone: Date | null;
  allCards?: CardModel[];
  dependencies?: DependencyModel[];
}) {
  const [editing, setEditing] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const tags = parseTags(card.tags);
  const typeColors = TASK_TYPE_COLORS[card.taskType] ?? TASK_TYPE_COLORS.OTHER;

  function handlePointerDown(e: React.PointerEvent) {
    pointerStart.current = { x: e.clientX, y: e.clientY };
  }

  function handleClick(e: React.MouseEvent) {
    if (pointerStart.current) {
      const dx = e.clientX - pointerStart.current.x;
      const dy = e.clientY - pointerStart.current.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) return;
    }
    setEditing(true);
  }

  return (
    <>
      <article
        onPointerDown={handlePointerDown}
        onClick={handleClick}
        className={`group border border-slate-300 dark:border-ocean-4 rounded-md bg-white dark:bg-ocean-2 px-3 py-2 flex gap-3 items-stretch cursor-pointer hover:bg-slate-50 dark:hover:bg-ocean-3 transition-colors h-[84px] overflow-hidden ${typeColors.border ? `border-l-[3px] ${typeColors.border}` : ""}`}
      >
        <div className="flex-1 flex flex-col gap-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-semibold text-sm text-ocean-1 dark:text-white break-words">
              {card.title}
            </h3>
          </div>
          {card.description && (
            <p
              className="italic text-xs text-slate-500 dark:text-skyblue-3 truncate"
              title={card.description}
            >
              {card.description}
            </p>
          )}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            {card.taskType !== "OTHER" && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${typeColors.badge}`}>
                {TASK_TYPE_LABELS[card.taskType] ?? card.taskType}
              </span>
            )}
            {card.codeReview && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300">
                Review
              </span>
            )}
          </div>
        </div>

        <div className="shrink-0 flex flex-col text-[10px] border-l border-slate-200 dark:border-ocean-4 -my-2 -mr-1 divide-y divide-slate-200 dark:divide-ocean-4">
          {card.estimateType === "WEEKS" && card.estimateWeeks && (
            <div className="flex-1 flex items-center pl-2 pr-1">
              <span className="font-medium text-slate-700 dark:text-skyblue-3">
                {card.estimateWeeks} {card.estimateWeeks === 1 ? "uke" : "uker"}
              </span>
            </div>
          )}
          {card.estimateType === "SCOPES" && (
            <div className="flex-1 flex items-center pl-2 pr-1">
              <span className="font-medium text-amber-500 dark:text-amber-400">Scopes</span>
            </div>
          )}
          {tags.map((tag) => (
            <div key={tag.name} className="flex-1 flex items-center pl-2 pr-1">
              <span className={tag.applicable ? "text-slate-700 dark:text-skyblue-3" : "text-slate-400 dark:text-ocean-6 line-through"}>
                {tag.name}
              </span>
            </div>
          ))}
          {card.estimateType === "HARD_DATE" && card.estimate ? (
            <div className="flex-1 flex items-center pl-2 pr-1">
              <span className="font-semibold text-ocean-5 dark:text-skyblue-1">{card.estimate}</span>
            </div>
          ) : estimatedDone ? (
            <div className="flex-1 flex items-center pl-2 pr-1">
              <span className="font-semibold text-ocean-5 dark:text-skyblue-1">{formatDate(estimatedDone)}</span>
            </div>
          ) : card.estimateType === "SCOPES" ? (
            <div className="flex-1 flex items-center pl-2 pr-1">
              <span className="font-semibold text-amber-500 dark:text-amber-400" title="Unscoped — no date estimate">?</span>
            </div>
          ) : null}
        </div>
      </article>

      {editing && (
        <EditCardModal
          card={card}
          onClose={() => setEditing(false)}
          allCards={allCards ?? []}
          dependencies={dependencies ?? []}
        />
      )}
    </>
  );
}
