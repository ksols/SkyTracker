"use client";

import { useState } from "react";
import type { ColumnModel } from "@/generated/prisma/models";
import { updateColumn, deleteColumn } from "@/features/board/actions";

export function ColumnHeader({ column, canEdit = true }: { column: ColumnModel; canEdit?: boolean }) {
  const [editing, setEditing] = useState(false);

  if (editing && canEdit) {
    return <ColumnEditForm column={column} onClose={() => setEditing(false)} />;
  }

  return (
    <header className="border border-slate-300 dark:border-ocean-4 rounded-md px-4 py-2 flex items-center justify-between bg-white dark:bg-ocean-3">
      <h2
        className={`font-semibold tracking-tight text-ocean-1 dark:text-white ${canEdit ? "cursor-pointer hover:underline" : ""}`}
        onClick={canEdit ? () => setEditing(true) : undefined}
        title={column.description || undefined}
      >
        {column.title}
      </h2>
      {canEdit && (
        <form action={deleteColumn}>
          <input type="hidden" name="id" value={column.id} />
          <button
            type="submit"
            className="text-xs text-slate-400 dark:text-ocean-6 hover:text-red-500 transition-colors"
            aria-label={`Delete column ${column.title}`}
            title="Delete column"
          >
            ✕
          </button>
        </form>
      )}
    </header>
  );
}

function ColumnEditForm({
  column,
  onClose,
}: {
  column: ColumnModel;
  onClose: () => void;
}) {
  async function handleSubmit(formData: FormData) {
    await updateColumn(formData);
    onClose();
  }

  return (
    <form
      action={handleSubmit}
      className="border border-slate-300 dark:border-ocean-4 rounded-md px-4 py-2 bg-white dark:bg-ocean-3 flex flex-col gap-2"
    >
      <input type="hidden" name="id" value={column.id} />
      <input
        name="title"
        type="text"
        required
        maxLength={80}
        defaultValue={column.title}
        autoFocus
        className="font-semibold tracking-tight text-ocean-1 dark:text-white bg-transparent focus:outline-none border-b border-slate-300 dark:border-ocean-5 focus:border-ocean-5 py-0.5"
      />
      <textarea
        name="description"
        maxLength={500}
        rows={2}
        defaultValue={column.description ?? ""}
        placeholder="Description (shown on hover)"
        className="text-xs text-slate-600 dark:text-skyblue-2 bg-transparent focus:outline-none border border-slate-300 dark:border-ocean-4 rounded px-2 py-1 resize-y"
      />
      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="text-xs text-slate-500 dark:text-skyblue-2 hover:text-ocean-1 dark:hover:text-white"
        >
          Cancel
        </button>
        <button
          type="submit"
          className="text-xs font-medium text-ocean-5 dark:text-skyblue-1 hover:underline"
        >
          Save
        </button>
      </div>
    </form>
  );
}
