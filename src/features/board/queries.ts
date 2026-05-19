import { prisma } from "@/lib/prisma";

export async function getOrCreateBoard() {
  const existing = await prisma.board.findFirst({ orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  return prisma.board.create({ data: { name: "SkyTracker" } });
}

export async function getBoardWithContents() {
  const board = await getOrCreateBoard();
  const columns = await prisma.column.findMany({
    where: { boardId: board.id },
    orderBy: { position: "asc" },
    include: {
      cards: { orderBy: { position: "asc" } },
    },
  });
  const dependencies = await prisma.dependency.findMany({
    where: {
      blockerCard: { boardId: board.id },
    },
  });
  return { board, columns, dependencies };
}
