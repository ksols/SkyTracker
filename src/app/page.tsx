import { auth } from "@/lib/auth";
import { getBoardWithContents } from "@/features/board/queries";
import { Board } from "@/components/board/Board";
import { SignOutButton } from "@/components/SignOutButton";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await auth();
  const { board, columns } = await getBoardWithContents();
  return (
    <main className="flex-1 flex flex-col">
      <div className="border-b border-zinc-200 dark:border-zinc-800 px-6 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">{board.name}</h1>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          {session?.user?.name && <span>{session.user.name}</span>}
          <SignOutButton />
        </div>
      </div>
      <Board columns={columns} />
    </main>
  );
}
