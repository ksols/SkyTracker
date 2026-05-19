"use client";

import { useState, useRef, useEffect } from "react";
import type { CardModel } from "@/generated/prisma/models";
import { formatDate } from "@/features/board/dates";
import { updateGapSize } from "@/features/board/actions";

const SLOT_PX = 84;

export function GapCard({ card, estimatedDone }: { card: CardModel; estimatedDone: Date | null }) {
  const [visualSize, setVisualSize] = useState(card.gapSize);
  const dragState = useRef<{ startY: number; startSize: number } | null>(null);

  useEffect(() => {
    setVisualSize(card.gapSize);
  }, [card.gapSize]);

  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragState.current) return;
      const delta = e.clientY - dragState.current.startY;
      const slotDelta = Math.round(delta / SLOT_PX);
      setVisualSize(Math.max(1, dragState.current.startSize + slotDelta));
    }

    function onUp(e: PointerEvent) {
      if (!dragState.current) return;
      const delta = e.clientY - dragState.current.startY;
      const slotDelta = Math.round(delta / SLOT_PX);
      const newSize = Math.max(1, dragState.current.startSize + slotDelta);
      dragState.current = null;
      setVisualSize(newSize);
      if (newSize !== card.gapSize) {
        updateGapSize(card.id, newSize);
      }
    }

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
    };
  }, [card.id, card.gapSize]);

  function handleResizeStart(e: React.PointerEvent) {
    e.stopPropagation();
    e.preventDefault();
    dragState.current = { startY: e.clientY, startSize: visualSize };
  }

  const height = visualSize * SLOT_PX + (visualSize - 1) * 8;

  const hasEstimate = card.estimateType === "WEEKS" || card.estimateType === "HARD_DATE";

  return (
    <div
      className="relative border border-dashed border-slate-300 dark:border-ocean-4 rounded-md bg-slate-50 dark:bg-ocean-1 px-3 py-2 flex justify-between cursor-pointer hover:border-ocean-5 dark:hover:border-ocean-5 transition-colors"
      style={{ minHeight: `${height}px` }}
    >
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-xs text-slate-600 dark:text-skyblue-3 italic truncate">
          {card.title !== "Gap" ? card.title : "Gap"}
        </span>
        {card.description && (
          <span className="text-[10px] text-slate-400 dark:text-ocean-6 truncate" title={card.description}>
            {card.description}
          </span>
        )}
      </div>
      <div className="shrink-0 flex flex-col text-[10px] text-right pl-2">
        {card.estimateType === "WEEKS" && card.estimateWeeks && (
          <span className="text-slate-500 dark:text-ocean-6">
            {card.estimateWeeks} {card.estimateWeeks === 1 ? "uke" : "uker"}
          </span>
        )}
        {!hasEstimate && (
          <span className="text-[10px] text-slate-400 dark:text-ocean-5">click to edit</span>
        )}
        {card.estimateType === "HARD_DATE" && card.estimate ? (
          <span className="font-semibold text-ocean-5 dark:text-skyblue-1 mt-auto">{card.estimate}</span>
        ) : estimatedDone ? (
          <span className="font-semibold text-ocean-5 dark:text-skyblue-1 mt-auto">
            {formatDate(estimatedDone)}
          </span>
        ) : null}
      </div>
      <div
        onPointerDown={handleResizeStart}
        className="absolute bottom-0 left-0 right-0 h-4 cursor-ns-resize flex items-center justify-center"
      >
        <div className="w-10 h-1.5 rounded-full bg-slate-300 dark:bg-ocean-4 hover:bg-ocean-5 dark:hover:bg-ocean-6 transition-colors" />
      </div>
    </div>
  );
}
