import { createColumn } from "@/features/board/actions";

export function AddColumnForm() {
  return (
    <form
      action={createColumn}
      className="border border-dashed border-slate-300 dark:border-ocean-4 rounded-md p-3 flex flex-col gap-2 bg-slate-50 dark:bg-ocean-2"
    >
      <input
        name="title"
        type="text"
        required
        maxLength={80}
        placeholder="+ New column"
        className="bg-transparent text-sm font-medium text-slate-700 dark:text-skyblue-3 placeholder:text-slate-400 dark:placeholder:text-ocean-5 focus:outline-none border-b border-transparent focus:border-ocean-5 transition-colors py-1"
      />
      <button
        type="submit"
        className="text-xs self-start text-slate-500 dark:text-ocean-6 hover:text-ocean-5 dark:hover:text-skyblue-1"
      >
        Add
      </button>
    </form>
  );
}
