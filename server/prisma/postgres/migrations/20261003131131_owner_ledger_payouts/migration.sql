-- AlterTable
ALTER TABLE "AccountSettings" ADD COLUMN     "ownerDrivesKeepsAll" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "paidAsDriver" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Transfer" ADD COLUMN     "guestPaidAt" TIMESTAMP(3),
ADD COLUMN     "guestPaidById" TEXT,
ADD COLUMN     "guestPaidByName" TEXT,
ADD COLUMN     "guestPaymentMethod" TEXT,
ADD COLUMN     "guestPaymentStatus" TEXT NOT NULL DEFAULT 'UNPAID';

-- CreateTable
CREATE TABLE "DriverPayout" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "driverUserId" TEXT,
    "driverContractorId" TEXT,
    "driverName" TEXT,
    "amountKzt" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3),
    "paidById" TEXT,
    "paidByName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverPayout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverPayout_jobId_key" ON "DriverPayout"("jobId");

-- CreateIndex
CREATE INDEX "DriverPayout_accountId_status_idx" ON "DriverPayout"("accountId", "status");

-- AddForeignKey
ALTER TABLE "DriverPayout" ADD CONSTRAINT "DriverPayout_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverPayout" ADD CONSTRAINT "DriverPayout_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TransferJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Данные. Трансферы, которые везёт/вёз сам владелец (выплата ещё не отмечена), — без выплаты, вся сумма бизнесу
UPDATE "TransferJob" SET "payoutKzt" = 0, "commissionKzt" = (SELECT t."priceKzt" FROM "Transfer" t WHERE t."id" = "TransferJob"."transferId"), "payoutRule" = 'owner', "payoutManual" = false
WHERE "paid" = false AND "driverUserId" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Membership" m WHERE m."userId" = "TransferJob"."driverUserId" AND m."accountId" = "TransferJob"."accountId" AND m."role" = 'owner');

-- Долги водителям за уже выполненные заказы (только если выплата > 0)
INSERT INTO "DriverPayout" ("id", "accountId", "jobId", "driverUserId", "driverContractorId", "driverName", "amountKzt", "status", "paidAt", "createdAt", "updatedAt")
SELECT 'dp_' || "id", "accountId", "id", "driverUserId", "driverContractorId", "driverName", "payoutKzt", CASE WHEN "paid" THEN 'PAID' ELSE 'PENDING' END, "paidAt", CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "TransferJob" WHERE "status" = 'DONE' AND "payoutKzt" > 0;

-- Оплата гостя: старый флаг Transfer.paid
UPDATE "Transfer" SET "guestPaymentStatus" = 'PAID' WHERE "paid" = true;
