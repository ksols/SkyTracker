import { auth } from "@/lib/auth";
import { getBoardWithContents } from "@/features/board/queries";
import { Board } from "@/components/board/Board";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  const { board, columns, dependencies } = await getBoardWithContents();
  return (
    <main className="flex-1 flex flex-col">
      <div className="border-b border-slate-200 dark:border-ocean-4 px-6 py-3 flex items-center justify-between bg-white dark:bg-ocean-2">
        <h1 className="text-lg font-semibold tracking-tight text-ocean-1 dark:text-white">{board.name}</h1>
        <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-skyblue-2">
          {session?.user?.name && <span>{session.user.name}</span>}
          <SignOutButton />
        </div>
      </div>
      <Board columns={columns} dependencies={dependencies} />
    </main>
  );
}
