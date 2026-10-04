-- AlterTable
ALTER TABLE "AccountSettings" ADD COLUMN     "driverStartWindowMin" INTEGER NOT NULL DEFAULT 120;

-- AlterTable
ALTER TABLE "Booking" ADD COLUMN     "earlyCheckIn" TEXT,
ADD COLUMN     "earlyCheckInStatus" TEXT;

-- AlterTable
ALTER TABLE "CleaningTask" ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedBy" TEXT;

-- CreateTable
CREATE TABLE "Defect" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "apartmentId" TEXT NOT NULL,
    "cleaningTaskId" TEXT,
    "repairTaskId" TEXT,
    "text" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'later',
    "status" TEXT NOT NULL DEFAULT 'open',
    "photoIds" JSONB,
    "reportedById" TEXT,
    "reportedByName" TEXT,
    "takenById" TEXT,
    "takenByName" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedByName" TEXT,
    "resolution" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Defect_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Defect_accountId_status_idx" ON "Defect"("accountId", "status");

-- CreateIndex
CREATE INDEX "Defect_apartmentId_status_idx" ON "Defect"("apartmentId", "status");

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_apartmentId_fkey" FOREIGN KEY ("apartmentId") REFERENCES "Apartment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_cleaningTaskId_fkey" FOREIGN KEY ("cleaningTaskId") REFERENCES "CleaningTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_repairTaskId_fkey" FOREIGN KEY ("repairTaskId") REFERENCES "RepairTask"("id") ON DELETE SET NULL ON UPDATE CASCADE;

