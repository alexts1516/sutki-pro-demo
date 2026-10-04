-- Проход 4, шаг 5 спецификации (миграция M2 `pass4_booking_links`, docs/PASS4_SPECIAL_BOOKING_SPEC.md, разделы 3а, 5, 21).
-- Только добавление: модель BookingLink (данные ссылки; логики ещё нет), журнал BookingPriceChange (без внешних ключей —
-- записи журнала не удаляются вместе с бронью) и Membership.canSetLinkPrice (по умолчанию false: у админов права нет).
-- Существующие данные не меняются. Ограничение booking_no_overlap (M1) не затрагивается.

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "canSetLinkPrice" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BookingLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "terms" TEXT NOT NULL,
    "depositKzt" INTEGER,
    "extraCheckRequired" BOOLEAN NOT NULL DEFAULT false,
    "extraCheckNote" TEXT,
    "extraCheckedAt" TIMESTAMP(3),
    "extraCheckedBy" TEXT,
    "note" TEXT,
    "termsHash" TEXT,
    "termsAcceptedAt" TIMESTAMP(3),
    "guestStartedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "depositReceivedAt" TIMESTAMP(3),
    "depositMarkedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "closedByName" TEXT,
    "openCount" INTEGER NOT NULL DEFAULT 0,
    "lastOpenedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingPriceChange" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "linkId" TEXT,
    "oldTotalKzt" INTEGER NOT NULL,
    "newTotalKzt" INTEGER NOT NULL,
    "standardTotalKzt" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "byUserId" TEXT,
    "byName" TEXT,
    "byRole" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BookingPriceChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BookingLink_bookingId_key" ON "BookingLink"("bookingId");

-- CreateIndex
CREATE UNIQUE INDEX "BookingLink_tokenHash_key" ON "BookingLink"("tokenHash");

-- CreateIndex
CREATE INDEX "BookingLink_accountId_status_idx" ON "BookingLink"("accountId", "status");

-- CreateIndex
CREATE INDEX "BookingPriceChange_accountId_bookingId_idx" ON "BookingPriceChange"("accountId", "bookingId");

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingLink" ADD CONSTRAINT "BookingLink_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE ON UPDATE CASCADE;
