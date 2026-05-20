"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getOrCreateBoard } from "@/features/board/queries";
import { DEFAULT_TAGS, parseTags, type CardTag } from "@/features/board/types";

type AuthResult = {
  user: { name?: string | null; email?: string | null };
  role: "writer" | "reader";
};

async function requireAuth(): Promise<AuthResult> {
  const session = await auth();
  if (!session?.user) {
    throw new Error("Unauthorized");
  }
  return { user: session.user, role: session.role ?? "reader" };
}

function requireWriter(authResult: AuthResult) {
  if (authResult.role !== "writer") {
    throw new Error("Read-only access — you do not have write permissions");
  }
}

async function audit(
  boardId: string,
  session: { user?: { name?: string | null; email?: string | null } },
  action: string,
  targetType: string,
  targetId: string,
  details?: Record<string, unknown>,
) {
  const userId = session.user?.email ?? undefined;
  const userName = session.user?.name ?? undefined;
  try {
    await prisma.auditLog.create({
      data: {
        boardId, userId, userName, action, targetType, targetId,
        details: details as Prisma.InputJsonValue | undefined,
      },
    });
  } catch (e) {
    console.error(JSON.stringify({ audit_write_failed: true, action, targetId, error: String(e) }));
  }
}

function log(action: string, user: string | undefined, detail: Record<string, unknown>) {
  console.log(JSON.stringify({ action, user, ...detail, ts: new Date().toISOString() }));
}

function logError(action: string, user: string | undefined, error: unknown) {
  console.error(
    JSON.stringify({
      action,
      user,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      ts: new Date().toISOString(),
    }),
  );
}

const idSchema = z.object({ id: z.string().min(1) });

// ─── Columns ──────────────────────────────────────────────────────

const createColumnSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

export async function createColumn(formData: FormData) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const { title } = createColumnSchema.parse({ title: formData.get("title") });
    const board = await getOrCreateBoard();
    const last = await prisma.column.findFirst({
      where: { boardId: board.id },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const column = await prisma.column.create({
      data: {
        boardId: board.id,
        title,
        position: (last?.position ?? -1) + 1,
      },
    });
    log("COLUMN_CREATED", userName, { columnId: column.id, title });
    await audit(board.id, session, "COLUMN_CREATED", "Column", column.id, { title });
    revalidatePath("/");
  } catch (error) {
    logError("COLUMN_CREATED", userName, error);
    throw error;
  }
}

const updateColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(500).optional().or(z.literal("")),
});

export async function updateColumn(formData: FormData) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const { id, title, description } = updateColumnSchema.parse({
      id: formData.get("id"),
      title: formData.get("title"),
      description: formData.get("description") ?? undefined,
    });
    const col = await prisma.column.update({
      where: { id },
      data: { title, description: description || null },
    });
    log("COLUMN_UPDATED", userName, { columnId: id, title });
    await audit(col.boardId, session, "COLUMN_UPDATED", "Column", id, { title, description: description || null });
    revalidatePath("/");
  } catch (error) {
    logError("COLUMN_UPDATED", userName, error);
    throw error;
  }
}

export async function deleteColumn(formData: FormData) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const { id } = idSchema.parse({ id: formData.get("id") });
    const col = await prisma.column.findUniqueOrThrow({ where: { id }, select: { boardId: true, title: true } });
    await prisma.column.delete({ where: { id } });
    log("COLUMN_DELETED", userName, { columnId: id });
    await audit(col.boardId, session, "COLUMN_DELETED", "Column", id, { title: col.title });
    revalidatePath("/");
  } catch (error) {
    logError("COLUMN_DELETED", userName, error);
    throw error;
  }
}

// ─── Cards ────────────────────────────────────────────────────────

const createCardSchema = z.object({
  columnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});

export async function createCard(formData: FormData) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const { columnId, title } = createCardSchema.parse({
      columnId: formData.get("columnId"),
      title: formData.get("title"),
    });
    const col = await prisma.column.findUniqueOrThrow({ where: { id: columnId } });
    const last = await prisma.card.findFirst({
      where: { columnId },
      orderBy: { position: "desc" },
      select: { position: true },
    });
    const card = await prisma.card.create({
      data: {
        boardId: col.boardId,
        columnId,
        title,
        position: (last?.position ?? -1) + 1,
        tags: DEFAULT_TAGS,
      },
    });
    log("CARD_CREATED", userName, { cardId: card.id, columnId, title });
    await audit(col.boardId, session, "CARD_CREATED", "Card", card.id, { columnId, title });
    revalidatePath("/");
  } catch (error) {
    logError("CARD_CREATED", userName, error);
    throw error;
  }
}


const updateCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  taskType: z.enum(["FEATURE", "WORK_ITEM", "BUG", "MAINTENANCE", "OTHER"]),
  estimateType: z.enum(["HARD_DATE", "WEEKS", "SCOPES", "NONE"]),
  estimate: z.string().trim().max(40).optional().or(z.literal("")),
  estimateDate: z.string().optional().or(z.literal("")),
  estimateWeeks: z.string().optional().or(z.literal("")),
  isGap: z.enum(["true", "false"]),
  gapSize: z.string().optional().or(z.literal("")),
  codeReview: z.enum(["true", "false"]),
  backendApplicable: z.enum(["true", "false"]),
  frontendApplicable: z.enum(["true", "false"]),
});

export async function updateCard(formData: FormData) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const parsed = updateCardSchema.parse({
      id: formData.get("id"),
      title: formData.get("title"),
      description: formData.get("description") ?? undefined,
      taskType: formData.get("taskType"),
      estimateType: formData.get("estimateType"),
      estimate: formData.get("estimate") ?? undefined,
      estimateDate: formData.get("estimateDate") ?? undefined,
      estimateWeeks: formData.get("estimateWeeks") ?? undefined,
      isGap: formData.getAll("isGap").includes("true") ? "true" : "false",
      gapSize: formData.get("gapSize") ?? undefined,
      codeReview: formData.getAll("codeReview").includes("true") ? "true" : "false",
      backendApplicable: formData.getAll("backendApplicable").includes("true") ? "true" : "false",
      frontendApplicable: formData.getAll("frontendApplicable").includes("true") ? "true" : "false",
    });

    const tags: CardTag[] = [
      { name: "Backend", applicable: parsed.backendApplicable === "true" },
      { name: "Frontend", applicable: parsed.frontendApplicable === "true" },
    ];

    const card = await prisma.card.update({
      where: { id: parsed.id },
      data: {
        title: parsed.title,
        description: parsed.description || null,
        taskType: parsed.taskType,
        estimateType: parsed.estimateType,
        estimate: parsed.estimate || null,
        estimateDate: parsed.estimateDate ? new Date(parsed.estimateDate) : null,
        estimateWeeks: parsed.estimateWeeks ? parseInt(parsed.estimateWeeks, 10) : null,
        isGap: parsed.isGap === "true",
        gapSize: parsed.gapSize ? Math.max(1, parseInt(parsed.gapSize, 10)) : 1,
        codeReview: parsed.codeReview === "true",
        tags,
      },
    });
    log("CARD_UPDATED", userName, { cardId: parsed.id });
    await audit(card.boardId, session, "CARD_UPDATED", "Card", parsed.id, {
      title: parsed.title,
      taskType: parsed.taskType,
      estimateType: parsed.estimateType,
      codeReview: parsed.codeReview === "true",
    });
    revalidatePath("/");
  } catch (error) {
    logError("CARD_UPDATED", userName, error);
    throw error;
  }
}

export async function deleteCard(formData: FormData) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const { id } = idSchema.parse({ id: formData.get("id") });
    const card = await prisma.card.findUniqueOrThrow({ where: { id }, select: { boardId: true, title: true, columnId: true } });
    await prisma.card.delete({ where: { id } });
    log("CARD_DELETED", userName, { cardId: id });
    await audit(card.boardId, session, "CARD_DELETED", "Card", id, { title: card.title, columnId: card.columnId });
    revalidatePath("/");
  } catch (error) {
    logError("CARD_DELETED", userName, error);
    throw error;
  }
}

const toggleTagSchema = z.object({
  id: z.string().min(1),
  tagName: z.string().min(1),
});

export async function toggleCardTag(formData: FormData) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const { id, tagName } = toggleTagSchema.parse({
      id: formData.get("id"),
      tagName: formData.get("tagName"),
    });
    const card = await prisma.card.findUniqueOrThrow({ where: { id } });
    const current = parseTags(card.tags);
    const next: CardTag[] = current.map((t) =>
      t.name === tagName ? { ...t, applicable: !t.applicable } : t,
    );
    await prisma.card.update({ where: { id }, data: { tags: next } });
    log("CARD_TAG_TOGGLED", userName, { cardId: id, tagName });
    await audit(card.boardId, session, "CARD_TAG_TOGGLED", "Card", id, { tagName, tags: next });
    revalidatePath("/");
  } catch (error) {
    logError("CARD_TAG_TOGGLED", userName, error);
    throw error;
  }
}

// ─── Gap Resize ──────────────────────────────────────────────────

export async function updateGapSize(cardId: string, gapSize: number) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const size = Math.max(1, Math.round(gapSize));
    const card = await prisma.card.update({
      where: { id: cardId },
      data: { gapSize: size },
    });
    log("GAP_RESIZED", userName, { cardId, gapSize: size });
    await audit(card.boardId, session, "GAP_RESIZED", "Card", cardId, { gapSize: size });
    revalidatePath("/");
  } catch (error) {
    logError("GAP_RESIZED", userName, error);
    throw error;
  }
}

// ─── Drag & Drop ──────────────────────────────────────────────────

export async function moveCard(cardId: string, targetColumnId: string, newPosition: number) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const card = await prisma.card.findUniqueOrThrow({ where: { id: cardId } });
    const fromColumnId = card.columnId;
    const sameColumn = fromColumnId === targetColumnId;

    if (sameColumn) {
      const cards = await prisma.column.findUniqueOrThrow({
        where: { id: targetColumnId },
        include: { cards: { orderBy: { position: "asc" } } },
      }).then((c) => c.cards);

      const filtered = cards.filter((c) => c.id !== cardId);
      filtered.splice(newPosition, 0, card);

      await prisma.$transaction(
        filtered.map((c, i) =>
          prisma.card.update({ where: { id: c.id }, data: { position: i } }),
        ),
      );
    } else {
      const [sourceCards, targetCards] = await Promise.all([
        prisma.card.findMany({ where: { columnId: fromColumnId }, orderBy: { position: "asc" } }),
        prisma.card.findMany({ where: { columnId: targetColumnId }, orderBy: { position: "asc" } }),
      ]);

      const updatedSource = sourceCards.filter((c) => c.id !== cardId);
      const updatedTarget = [...targetCards];
      updatedTarget.splice(newPosition, 0, card);

      await prisma.$transaction([
        prisma.card.update({
          where: { id: cardId },
          data: { columnId: targetColumnId, position: newPosition },
        }),
        ...updatedSource.map((c, i) =>
          prisma.card.update({ where: { id: c.id }, data: { position: i } }),
        ),
        ...updatedTarget
          .filter((c) => c.id !== cardId)
          .map((c, i) => {
            const pos = i >= newPosition ? i + 1 : i;
            return prisma.card.update({ where: { id: c.id }, data: { position: pos } });
          }),
      ]);
    }

    log("CARD_MOVED", userName, {
      cardId,
      from: fromColumnId,
      to: targetColumnId,
      position: newPosition,
    });
    await audit(card.boardId, session, "CARD_MOVED", "Card", cardId, {
      fromColumnId,
      toColumnId: targetColumnId,
      position: newPosition,
    });
    revalidatePath("/");
  } catch (error) {
    logError("CARD_MOVED", userName, error);
    throw error;
  }
}

// ─── Dependencies ─────────────────────────────────────────────────

export async function createDependency(blockerCardId: string, blockedCardId: string) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    if (blockerCardId === blockedCardId) throw new Error("A card cannot depend on itself");

    const blocker = await prisma.card.findUniqueOrThrow({ where: { id: blockerCardId } });

    const existing = await prisma.dependency.findUnique({
      where: { blockerCardId_blockedCardId: { blockerCardId, blockedCardId } },
    });
    if (existing) return;

    const dep = await prisma.dependency.create({
      data: { blockerCardId, blockedCardId },
    });
    log("DEPENDENCY_CREATED", userName, { id: dep.id, blockerCardId, blockedCardId });
    await audit(blocker.boardId, session, "DEPENDENCY_CREATED", "Dependency", dep.id, {
      blockerCardId,
      blockedCardId,
    });
    revalidatePath("/");
  } catch (error) {
    logError("DEPENDENCY_CREATED", userName, error);
    throw error;
  }
}

export async function deleteDependency(dependencyId: string) {
  const session = await requireAuth();
  requireWriter(session);
  const userName = session.user?.name ?? undefined;
  try {
    const dep = await prisma.dependency.findUniqueOrThrow({
      where: { id: dependencyId },
      include: { blockerCard: { select: { boardId: true } } },
    });
    await prisma.dependency.delete({ where: { id: dependencyId } });
    log("DEPENDENCY_DELETED", userName, { id: dependencyId });
    await audit(dep.blockerCard.boardId, session, "DEPENDENCY_DELETED", "Dependency", dependencyId, {
      blockerCardId: dep.blockerCardId,
      blockedCardId: dep.blockedCardId,
    });
    revalidatePath("/");
  } catch (error) {
    logError("DEPENDENCY_DELETED", userName, error);
    throw error;
  }
}
