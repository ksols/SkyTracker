import type { CardModel } from "@/generated/prisma/models";
import { deleteCard, toggleCardTag } from "@/features/board/actions";
import { parseTags } from "@/features/board/types";

export function Card({ card }: { card: CardModel }) {
  const tags = parseTags(card.tags);

  return (
    <article className="group border border-black dark:border-zinc-300 rounded-md bg-white dark:bg-zinc-950 px-3 py-2 flex gap-3 items-stretch">
      <div className="flex-1 flex flex-col gap-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <h3 className="font-semibold text-sm text-black dark:text-zinc-100 break-words">
            {card.title}
          </h3>
          <form action={deleteCard}>
            <input type="hidden" name="id" value={card.id} />
            <button
              type="submit"
              className="opacity-0 group-hover:opacity-100 text-xs text-zinc-400 hover:text-red-500 transition"
              aria-label={`Delete card ${card.title}`}
              title="Delete card"
            >
              ✕
            </button>
          </form>
        </div>
        {card.description && (
          <p className="italic text-xs text-zinc-600 dark:text-zinc-400 break-words">
            {card.description}
          </p>
        )}
      </div>

      <div className="shrink-0 flex flex-col text-[10px] border-l border-zinc-300 dark:border-zinc-700 pl-2 -my-2 -mr-1 py-1">
        <div className="font-medium text-zinc-800 dark:text-zinc-200 min-h-[14px] mb-1">
          {card.estimate ?? <span className="text-zinc-400">—</span>}
        </div>
        {tags.map((tag) => (
          <form key={tag.name} action={toggleCardTag} className="leading-tight">
            <input type="hidden" name="id" value={card.id} />
            <input type="hidden" name="tagName" value={tag.name} />
            <button
              type="submit"
              className={
                "block w-full text-left hover:bg-zinc-100 dark:hover:bg-zinc-800 px-1 -mx-1 rounded transition-colors " +
                (tag.applicable
                  ? "text-zinc-800 dark:text-zinc-200"
                  : "text-zinc-400 line-through")
              }
              title={tag.applicable ? `Mark ${tag.name} N/A` : `Mark ${tag.name} applicable`}
            >
              {tag.name}
            </button>
          </form>
        ))}
      </div>
    </article>
  );
}
