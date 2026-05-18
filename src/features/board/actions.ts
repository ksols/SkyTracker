"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { auth } from "@/lib/auth";
import { getOrCreateBoard } from "@/features/board/queries";
import { DEFAULT_TAGS, parseTags, type CardTag } from "@/features/board/types";

async function requireAuth() {
  const session = await auth();
  if (!session?.user) throw new Error("Unauthorized");
  return session;
}

const idSchema = z.object({ id: z.string().min(1) });

// ─── Columns ──────────────────────────────────────────────────────

const createColumnSchema = z.object({
  title: z.string().trim().min(1).max(80),
});

export async function createColumn(formData: FormData) {
  await requireAuth();
  const { title } = createColumnSchema.parse({ title: formData.get("title") });
  const board = await getOrCreateBoard();
  const last = await prisma.column.findFirst({
    where: { boardId: board.id },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  await prisma.column.create({
    data: {
      boardId: board.id,
      title,
      position: (last?.position ?? -1) + 1,
    },
  });
  revalidatePath("/");
}

const renameColumnSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(80),
});

export async function renameColumn(formData: FormData) {
  await requireAuth();
  const { id, title } = renameColumnSchema.parse({
    id: formData.get("id"),
    title: formData.get("title"),
  });
  await prisma.column.update({ where: { id }, data: { title } });
  revalidatePath("/");
}

export async function deleteColumn(formData: FormData) {
  await requireAuth();
  const { id } = idSchema.parse({ id: formData.get("id") });
  await prisma.column.delete({ where: { id } });
  revalidatePath("/");
}

// ─── Cards ────────────────────────────────────────────────────────

const createCardSchema = z.object({
  columnId: z.string().min(1),
  title: z.string().trim().min(1).max(200),
});

export async function createCard(formData: FormData) {
  await requireAuth();
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
  await prisma.card.create({
    data: {
      boardId: col.boardId,
      columnId,
      title,
      position: (last?.position ?? -1) + 1,
      tags: DEFAULT_TAGS,
    },
  });
  revalidatePath("/");
}

const updateCardSchema = z.object({
  id: z.string().min(1),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  estimate: z.string().trim().max(40).optional().or(z.literal("")),
});

export async function updateCard(formData: FormData) {
  await requireAuth();
  const parsed = updateCardSchema.parse({
    id: formData.get("id"),
    title: formData.get("title"),
    description: formData.get("description") ?? undefined,
    estimate: formData.get("estimate") ?? undefined,
  });
  await prisma.card.update({
    where: { id: parsed.id },
    data: {
      title: parsed.title,
      description: parsed.description || null,
      estimate: parsed.estimate || null,
    },
  });
  revalidatePath("/");
}

export async function deleteCard(formData: FormData) {
  await requireAuth();
  const { id } = idSchema.parse({ id: formData.get("id") });
  await prisma.card.delete({ where: { id } });
  revalidatePath("/");
}

const toggleTagSchema = z.object({
  id: z.string().min(1),
  tagName: z.string().min(1),
});

export async function toggleCardTag(formData: FormData) {
  await requireAuth();
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
  revalidatePath("/");
}
