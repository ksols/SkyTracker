import type { ColumnModel, CardModel } from "@/generated/prisma/models";
import { Column } from "./Column";
import { AddColumnForm } from "./AddColumnForm";

type ColumnWithCards = ColumnModel & { cards: CardModel[] };

export function Board({ columns }: { columns: ColumnWithCards[] }) {
  return (
    <div className="flex gap-6 overflow-x-auto p-6 min-h-full items-start">
      {columns.map((col) => (
        <Column key={col.id} column={col} />
      ))}
      <div className="shrink-0 w-72">
        <AddColumnForm />
      </div>
    </div>
  );
}
