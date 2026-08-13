-- CreateTable
CREATE TABLE "TimelineChange" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "taskLabel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "groups" TEXT,
    "before" JSONB,
    "after" JSONB,
    "editor" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimelineChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimelineChange_at_idx" ON "TimelineChange"("at");
