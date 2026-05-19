"use client";

import { useState, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CardModel } from "@/generated/prisma/models";
import type { DependencyModel } from "@/generated/prisma/models";
import { Card } from "./Card";
import { GapCard } from "./GapCard";
import { EditCardModal } from "./EditCardModal";

export function SortableCard({
  card,
  estimatedDone,
  allCards,
  dependencies,
}: {
  card: CardModel;
  estimatedDone: Date | null;
  allCards: CardModel[];
  dependencies: DependencyModel[];
}) {
  const [editing, setEditing] = useState(false);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
  };

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
      <div
        ref={setNodeRef}
        style={style}
        data-card-id={card.id}
        onPointerDown={handlePointerDown}
        onClick={card.isGap ? handleClick : undefined}
        {...attributes}
        {...listeners}
      >
        {card.isGap ? (
          <GapCard card={card} estimatedDone={estimatedDone} />
        ) : (
          <Card card={card} estimatedDone={estimatedDone} allCards={allCards} dependencies={dependencies} />
        )}
      </div>
      {editing && card.isGap && (
        <EditCardModal
          card={card}
          onClose={() => setEditing(false)}
          allCards={allCards}
          dependencies={dependencies}
        />
      )}
    </>
  );
}
