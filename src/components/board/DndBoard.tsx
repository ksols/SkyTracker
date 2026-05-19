"use client";

import { useState, useCallback, useRef } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { sortableKeyboardCoordinates } from "@dnd-kit/sortable";
import type { CardModel } from "@/generated/prisma/models";
import type { DependencyModel } from "@/generated/prisma/models";
import { moveCard } from "@/features/board/actions";
import type { ColumnWithCards } from "./Board";
import { SortableColumn } from "./SortableColumn";
import { CardOverlay } from "./CardOverlay";
import { DependencyLines } from "./DependencyLines";

export function DndBoard({
  columns: initialColumns,
  dependencies,
}: {
  columns: ColumnWithCards[];
  dependencies: DependencyModel[];
}) {
  const [columns, setColumns] = useState(initialColumns);
  const [activeCard, setActiveCard] = useState<CardModel | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  if (initialColumns !== columns && !activeCard) {
    setColumns(initialColumns);
  }

  const allCards = columns.flatMap((col) => col.cards);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const findColumnByCardId = useCallback(
    (cardId: string) => columns.find((col) => col.cards.some((c) => c.id === cardId)),
    [columns],
  );

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const col = findColumnByCardId(active.id as string);
    const card = col?.cards.find((c) => c.id === active.id);
    setActiveCard(card ?? null);
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeCol = findColumnByCardId(activeId);
    let overCol = findColumnByCardId(overId);
    if (!overCol) {
      overCol = columns.find((col) => col.id === overId);
    }

    if (!activeCol || !overCol || activeCol.id === overCol.id) return;

    setColumns((prev) => {
      const sourceCol = prev.find((c) => c.id === activeCol.id)!;
      const targetCol = prev.find((c) => c.id === overCol.id)!;

      const card = sourceCol.cards.find((c) => c.id === activeId)!;
      const newSourceCards = sourceCol.cards.filter((c) => c.id !== activeId);

      const overIndex = targetCol.cards.findIndex((c) => c.id === overId);
      const insertIndex = overIndex >= 0 ? overIndex : targetCol.cards.length;
      const newTargetCards = [...targetCol.cards];
      newTargetCards.splice(insertIndex, 0, card);

      return prev.map((col) => {
        if (col.id === sourceCol.id) return { ...col, cards: newSourceCards };
        if (col.id === targetCol.id) return { ...col, cards: newTargetCards };
        return col;
      });
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCard(null);

    if (!over) {
      setColumns(initialColumns);
      return;
    }

    const activeId = active.id as string;
    const overId = over.id as string;

    const targetCol = columns.find((col) => col.cards.some((c) => c.id === activeId));
    if (!targetCol) {
      setColumns(initialColumns);
      return;
    }

    let newPosition: number;
    if (activeId === overId) {
      newPosition = targetCol.cards.findIndex((c) => c.id === activeId);
    } else {
      const overIndex = targetCol.cards.findIndex((c) => c.id === overId);
      const activeIndex = targetCol.cards.findIndex((c) => c.id === activeId);
      if (overIndex >= 0) {
        const reordered = [...targetCol.cards];
        const [moved] = reordered.splice(activeIndex, 1);
        reordered.splice(overIndex, 0, moved);

        setColumns((prev) =>
          prev.map((col) =>
            col.id === targetCol.id ? { ...col, cards: reordered } : col,
          ),
        );
        newPosition = overIndex;
      } else {
        newPosition = targetCol.cards.findIndex((c) => c.id === activeId);
      }
    }

    if (newPosition < 0) newPosition = 0;

    await moveCard(activeId, targetCol.id, newPosition);
  }

  return (
    <div ref={containerRef} className="relative flex gap-6">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        {columns.map((col) => (
          <SortableColumn key={col.id} column={col} allCards={allCards} dependencies={dependencies} />
        ))}
        <DragOverlay>
          {activeCard ? <CardOverlay card={activeCard} /> : null}
        </DragOverlay>
      </DndContext>
      <DependencyLines dependencies={dependencies} containerRef={containerRef} />
    </div>
  );
}
