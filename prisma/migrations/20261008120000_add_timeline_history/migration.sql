-- CreateTable
CREATE TABLE "TimelineChangeset" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editor" TEXT,
    "source" TEXT NOT NULL DEFAULT 'bruker',
    "reason" TEXT,
    "reasonCode" TEXT,
    "planVersion" INTEGER NOT NULL,
    "eventCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TimelineChangeset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineEvent" (
    "id" TEXT NOT NULL,
    "changesetId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editor" TEXT,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetLabel" TEXT NOT NULL,
    "laneKey" TEXT,
    "code" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "cause" TEXT NOT NULL DEFAULT 'bruker',
    "causeRef" TEXT,
    "summary" TEXT NOT NULL,

    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimelineSnapshot" (
    "id" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kind" TEXT NOT NULL,
    "day" TEXT,
    "label" TEXT,
    "planVersion" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "createdBy" TEXT,

    CONSTRAINT "TimelineSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TimelineChangeset_at_idx" ON "TimelineChangeset"("at");

-- CreateIndex
CREATE INDEX "TimelineEvent_at_idx" ON "TimelineEvent"("at");

-- CreateIndex
CREATE INDEX "TimelineEvent_laneKey_at_idx" ON "TimelineEvent"("laneKey", "at");

-- CreateIndex
CREATE INDEX "TimelineEvent_targetId_at_idx" ON "TimelineEvent"("targetId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "TimelineSnapshot_kind_day_key" ON "TimelineSnapshot"("kind", "day");

-- CreateIndex
CREATE INDEX "TimelineSnapshot_at_idx" ON "TimelineSnapshot"("at");

-- AddForeignKey
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_changesetId_fkey" FOREIGN KEY ("changesetId") REFERENCES "TimelineChangeset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
