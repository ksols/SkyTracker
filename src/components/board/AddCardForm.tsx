import { createCard } from "@/features/board/actions";

export function AddCardForm({ columnId }: { columnId: string }) {
  return (
    <form
      action={createCard}
      className="border border-dashed border-slate-300 dark:border-ocean-4 rounded-md p-2"
    >
      <input type="hidden" name="columnId" value={columnId} />
      <input
        name="title"
        type="text"
        required
        maxLength={200}
        placeholder="+ New card"
        className="w-full bg-transparent text-sm text-slate-700 dark:text-skyblue-3 placeholder:text-slate-400 dark:placeholder:text-ocean-5 focus:outline-none"
      />
    </form>
  );
}
