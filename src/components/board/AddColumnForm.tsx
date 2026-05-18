import { createColumn } from "@/features/board/actions";

export function AddColumnForm() {
  return (
    <form
      action={createColumn}
      className="border border-dashed border-zinc-400 dark:border-zinc-600 rounded-md p-3 flex flex-col gap-2 bg-zinc-50 dark:bg-zinc-900"
    >
      <input
        name="title"
        type="text"
        required
        maxLength={80}
        placeholder="+ New column"
        className="bg-transparent text-sm font-medium text-zinc-700 dark:text-zinc-200 placeholder:text-zinc-400 focus:outline-none border-b border-transparent focus:border-zinc-400 transition-colors py-1"
      />
      <button
        type="submit"
        className="text-xs self-start text-zinc-500 hover:text-black dark:hover:text-zinc-100"
      >
        Add
      </button>
    </form>
  );
}
