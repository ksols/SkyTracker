-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('FEATURE', 'WORK_ITEM', 'BUG', 'MAINTENANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "EstimateType" AS ENUM ('HARD_DATE', 'WEEKS', 'SCOPES', 'NONE');

-- AlterTable
ALTER TABLE "Card" ADD COLUMN     "codeReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "estimateDate" TIMESTAMP(3),
ADD COLUMN     "estimateType" "EstimateType" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "estimateWeeks" INTEGER,
ADD COLUMN     "isGap" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "taskType" "TaskType" NOT NULL DEFAULT 'OTHER';

-- CreateTable
CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL,
    "blockerCardId" TEXT NOT NULL,
    "blockedCardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Dependency_blockedCardId_idx" ON "Dependency"("blockedCardId");

-- CreateIndex
CREATE UNIQUE INDEX "Dependency_blockerCardId_blockedCardId_key" ON "Dependency"("blockerCardId", "blockedCardId");

-- CreateIndex
CREATE INDEX "AuditLog_boardId_createdAt_idx" ON "AuditLog"("boardId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_blockerCardId_fkey" FOREIGN KEY ("blockerCardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dependency" ADD CONSTRAINT "Dependency_blockedCardId_fkey" FOREIGN KEY ("blockedCardId") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;
