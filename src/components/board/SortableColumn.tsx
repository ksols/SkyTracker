"use client";

import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { CardModel } from "@/generated/prisma/models";
import type { DependencyModel } from "@/generated/prisma/models";
import { computeEstimatedDates } from "@/features/board/dates";
import type { ColumnWithCards } from "./Board";
import { SortableCard } from "./SortableCard";
import { ColumnHeader } from "./ColumnHeader";
import { AddCardForm } from "./AddCardForm";

export function SortableColumn({
  column,
  allCards,
  dependencies,
  canEdit = true,
}: {
  column: ColumnWithCards;
  allCards: CardModel[];
  dependencies: DependencyModel[];
  canEdit?: boolean;
}) {
  const { setNodeRef } = useDroppable({ id: column.id });
  const cardIds = column.cards.map((c) => c.id);

  const estimatedDates = useMemo(
    () => computeEstimatedDates(column.cards),
    [column.cards],
  );

  return (
    <div className="shrink-0 w-72 flex flex-col gap-3">
      <ColumnHeader column={column} canEdit={canEdit} />
      <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex flex-col gap-2 min-h-[40px]">
          {column.cards.map((card) => (
            <SortableCard
              key={card.id}
              card={card}
              estimatedDone={estimatedDates.get(card.id) ?? null}
              allCards={allCards}
              dependencies={dependencies}
              canEdit={canEdit}
            />
          ))}
        </div>
      </SortableContext>
      {canEdit && <AddCardForm columnId={column.id} />}
    </div>
  );
}
