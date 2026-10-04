-- Проход 4, шаг 1 спецификации (миграция фундамента M1, docs/PASS4_SPECIAL_BOOKING_SPEC.md, раздел 21).
-- SQLite (разработка, демо, быстрые тесты): ограничения EXCLUDE здесь нет и быть не может — см. раздел 22.
-- Поведение кода этой миграцией не меняется: новые поля пока не читаются.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN "holdUntil" DATETIME;

-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN "autoKey" TEXT;

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Booking_apartmentId_status_holdUntil_idx" ON "Booking"("apartmentId", "status", "holdUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningTask_autoKey_key" ON "CleaningTask"("autoKey");

-- M1.5: старые неоплаченные заявки получают срок удержания (24 ч от миграции), чтобы потом не держать даты вечно.
-- SQLite-Prisma хранит DateTime как миллисекунды Unix.
UPDATE "Booking" SET "holdUntil" = (CAST(strftime('%s', 'now') AS INTEGER) + 86400) * 1000
WHERE "status" = 'request' AND "holdUntil" IS NULL;
