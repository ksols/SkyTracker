import type { ColumnModel, CardModel } from "@/generated/prisma/models";
import type { DependencyModel } from "@/generated/prisma/models";
import { DndBoard } from "./DndBoard";
import { AddColumnForm } from "./AddColumnForm";

export type ColumnWithCards = ColumnModel & { cards: CardModel[] };

export function Board({
  columns,
  dependencies,
}: {
  columns: ColumnWithCards[];
  dependencies: DependencyModel[];
}) {
  return (
    <div className="flex gap-6 overflow-x-auto p-6 min-h-full items-start">
      <DndBoard columns={columns} dependencies={dependencies} />
      <div className="shrink-0 w-72">
        <AddColumnForm />
      </div>
    </div>
  );
}
