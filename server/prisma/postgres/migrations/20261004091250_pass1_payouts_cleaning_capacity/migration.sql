-- AlterTable
ALTER TABLE "AccountSettings" ADD COLUMN     "cleaningChecklist" JSONB,
ADD COLUMN     "cleaningRateKzt" INTEGER,
ADD COLUMN     "cleaningRates" JSONB,
ADD COLUMN     "payoutReminderHours" INTEGER NOT NULL DEFAULT 3;

-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "vehicleBags" INTEGER,
ADD COLUMN     "vehicleClass" TEXT,
ADD COLUMN     "vehicleSeats" INTEGER;

-- AlterTable
ALTER TABLE "Apartment" ADD COLUMN     "cleaningExtraItems" JSONB,
ADD COLUMN     "cleaningRateKzt" INTEGER;

-- AlterTable
ALTER TABLE "DriverPayout" ADD COLUMN     "cleaningTaskId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'transfer',
ADD COLUMN     "method" TEXT,
ADD COLUMN     "remindedAt" TIMESTAMP(3),
ADD COLUMN     "repairTaskId" TEXT,
ADD COLUMN     "title" TEXT,
ALTER COLUMN "jobId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN     "finishNote" TEXT,
ADD COLUMN     "problems" JSONB,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "RepairTask" ADD COLUMN     "declinedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CleaningPhoto" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "cleaningTaskId" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'item',
    "itemIndex" INTEGER,
    "url" TEXT NOT NULL,
    "storageKey" TEXT,
    "mimeType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleaningPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CleaningPhoto_cleaningTaskId_idx" ON "CleaningPhoto"("cleaningTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverPayout_cleaningTaskId_key" ON "DriverPayout"("cleaningTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverPayout_repairTaskId_key" ON "DriverPayout"("repairTaskId");

-- AddForeignKey
ALTER TABLE "DriverPayout" ADD CONSTRAINT "DriverPayout_cleaningTaskId_fkey" FOREIGN KEY ("cleaningTaskId") REFERENCES "CleaningTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverPayout" ADD CONSTRAINT "DriverPayout_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningPhoto" ADD CONSTRAINT "CleaningPhoto_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CleaningPhoto" ADD CONSTRAINT "CleaningPhoto_cleaningTaskId_fkey" FOREIGN KEY ("cleaningTaskId") REFERENCES "CleaningTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

