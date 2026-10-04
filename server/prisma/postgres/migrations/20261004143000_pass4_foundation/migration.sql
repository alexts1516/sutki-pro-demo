-- Проход 4, шаг 1 спецификации (миграция фундамента M1, docs/PASS4_SPECIAL_BOOKING_SPEC.md, разделы 10 и 21).
-- Часть ниже «РУЧНОЙ SQL» Prisma не генерирует и не описывает в схеме: применять только `prisma migrate deploy`
-- (npm run pg:deploy). `prisma db push` для PostgreSQL запрещён — он удалит ограничение booking_no_overlap.

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "holdUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN     "autoKey" TEXT;

-- CreateTable
CREATE TABLE "OutboxEvent" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "OutboxEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OutboxEvent_dedupeKey_key" ON "OutboxEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "OutboxEvent_status_nextAttemptAt_idx" ON "OutboxEvent"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "Booking_apartmentId_status_holdUntil_idx" ON "Booking"("apartmentId", "status", "holdUntil");

-- CreateIndex
CREATE UNIQUE INDEX "CleaningTask_autoKey_key" ON "CleaningTask"("autoKey");

-- ===================== РУЧНОЙ SQL (не из Prisma) =====================

-- M1.5: старые неоплаченные заявки получают срок удержания (24 ч от миграции), чтобы потом не держать даты вечно.
UPDATE "Booking" SET "holdUntil" = (now() AT TIME ZONE 'UTC') + interval '24 hours'
WHERE "status" = 'request' AND "holdUntil" IS NULL;

-- M1.5: проверка данных до ограничения — миграция падает с понятным сообщением, а не молча.
DO $$
DECLARE bad_range int; bad_pairs int; example text;
BEGIN
  SELECT count(*) INTO bad_range FROM "Booking"
  WHERE "status" IN ('request', 'confirmed') AND "checkOut" < "checkIn";
  IF bad_range > 0 THEN
    RAISE EXCEPTION 'Проход 4: % блокирующих броней с выездом раньше заезда. Исправьте даты (или отмените брони) и повторите миграцию.', bad_range;
  END IF;

  SELECT count(*), min(a."number"::text || ' и ' || b."number"::text || ' (квартира ' || a."apartmentId" || ')')
    INTO bad_pairs, example
  FROM "Booking" a
  JOIN "Booking" b ON a."apartmentId" = b."apartmentId" AND a."id" < b."id"
  WHERE a."status" IN ('request', 'confirmed') AND b."status" IN ('request', 'confirmed')
    AND tsrange(a."checkIn", a."checkOut", '[)') && tsrange(b."checkIn", b."checkOut", '[)');
  IF bad_pairs > 0 THEN
    RAISE EXCEPTION 'Проход 4: найдено % пар пересекающихся броней (заявка/подтверждена) одной квартиры, например брони №%. Отмените лишнюю бронь или измените даты и повторите миграцию.', bad_pairs, example;
  END IF;
END $$;

-- M1.4: гарантия базы против двойной брони (раздел 10). Даты — полуинтервал [заезд, выезд): брони встык разрешены.
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "Booking" ADD CONSTRAINT booking_no_overlap
  EXCLUDE USING gist ("apartmentId" WITH =, tsrange("checkIn", "checkOut", '[)') WITH &&)
  WHERE ("status" IN ('request', 'confirmed'));
