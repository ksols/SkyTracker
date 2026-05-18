import type { ColumnModel, CardModel } from "@/generated/prisma/models";
import { deleteColumn } from "@/features/board/actions";
import { Card } from "./Card";
import { AddCardForm } from "./AddCardForm";

export function Column({ column }: { column: ColumnModel & { cards: CardModel[] } }) {
  return (
    <div className="shrink-0 w-72 flex flex-col gap-3">
      <header className="border border-black dark:border-zinc-200 rounded-md px-4 py-2 flex items-center justify-between bg-white dark:bg-zinc-900">
        <h2 className="font-semibold tracking-tight text-black dark:text-zinc-100">
          {column.title}
        </h2>
        <form action={deleteColumn}>
          <input type="hidden" name="id" value={column.id} />
          <button
            type="submit"
            className="text-xs text-zinc-400 hover:text-red-500 transition-colors"
            aria-label={`Delete column ${column.title}`}
            title="Delete column"
          >
            ✕
          </button>
        </form>
      </header>

      <div className="flex flex-col gap-2">
        {column.cards.map((card) => (
          <Card key={card.id} card={card} />
        ))}
      </div>

      <AddCardForm columnId={column.id} />
    </div>
  );
}
