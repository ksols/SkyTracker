-- CreateTable
CREATE TABLE "BufferSnapshot" (
    "id" TEXT NOT NULL,
    "week" TEXT NOT NULL,
    "milestoneId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "bufferWeeks" DOUBLE PRECISION NOT NULL,
    "usedWeeks" DOUBLE PRECISION NOT NULL,
    "overrunWeeks" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BufferSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BufferSnapshot_week_milestoneId_key" ON "BufferSnapshot"("week", "milestoneId");

-- CreateIndex
CREATE INDEX "BufferSnapshot_milestoneId_week_idx" ON "BufferSnapshot"("milestoneId", "week");
