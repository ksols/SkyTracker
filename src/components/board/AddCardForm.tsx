import { createCard } from "@/features/board/actions";

export function AddCardForm({ columnId }: { columnId: string }) {
  return (
    <form
      action={createCard}
      className="border border-dashed border-zinc-300 dark:border-zinc-700 rounded-md p-2"
    >
      <input type="hidden" name="columnId" value={columnId} />
      <input
        name="title"
        type="text"
        required
        maxLength={200}
        placeholder="+ New card"
        className="w-full bg-transparent text-sm text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none"
      />
    </form>
  );
}
